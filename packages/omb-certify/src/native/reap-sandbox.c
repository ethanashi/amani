/* Host-only Darwin supervisor. Identify descendants by their inherited sandbox policy,
 * not mutable ppid, process group, cwd or environment. sandbox_check SPI constants:
 * WebKit Source/WTF/wtf/spi/darwin/SandboxSPI.h. */
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/wait.h>
#include <signal.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <time.h>
extern int sandbox_check(pid_t,const char *,int,...);
extern const int SANDBOX_CHECK_NO_REPORT;
static pid_t pids[65536],stopped[65536];
typedef struct { pid_t pid; uint64_t seconds,micros; } Identity;
static Identity before[65536];static int before_count=0;
/* Bounded diagnostic evidence only; never consulted for signaling or census decisions.
 * Store basenames (no arguments, environment or user-directory paths). */
static struct { Identity identity; char executable[97]; } matched[32];
static int matched_count=0,matched_truncated=0;
static void retain_match(Identity identity){
  if(matched_count==32){matched_truncated=1;return;}
  int saved=errno,index=matched_count++;matched[index].identity=identity;
  matched[index].executable[0]=0;
  char executable[PROC_PIDPATHINFO_MAXSIZE];struct proc_bsdinfo after;
  int length=proc_pidpath(identity.pid,executable,sizeof(executable));
  /* Bind the path lookup to the same stopped process identity. Missing/reused
   * identities retain the original match proof but no executable attribution. */
  if(length>0&&length<(int)sizeof(executable)&&
     proc_pidinfo(identity.pid,PROC_PIDTBSDINFO,0,&after,sizeof(after))==sizeof(after)&&
     after.pbi_start_tvsec==identity.seconds&&after.pbi_start_tvusec==identity.micros){
    executable[length]=0;const char*base=strrchr(executable,'/');base=base?base+1:executable;
    int n=0;while(base[n]&&n<96){unsigned char c=base[n];
      matched[index].executable[n]=(c>='a'&&c<='z'||c>='A'&&c<='Z'||c>='0'&&c<='9'||c=='.'||c=='_'||c=='+'||c=='-')?c:'_';n++;}
    matched[index].executable[n]=0;
  }
  errno=saved;
}
/* A zombie cannot fork again. Remember only its proven exact identity, after
 * forcing this first observation to remain unresolved. The next full snapshot
 * must inspect any successor born before it exited; two later clean passes are
 * still required. Never cache ESRCH without birth proof or live policy answers. */
static int observed_dead(pid_t pid,const struct proc_bsdinfo *info){
  if(info->pbi_start_tvsec>0&&info->pbi_start_tvusec<1000000&&before_count<(int)(sizeof(before)/sizeof(before[0])))
    before[before_count++]=(Identity){pid,info->pbi_start_tvsec,info->pbi_start_tvusec};
  return -2;
}
static volatile sig_atomic_t interrupted=0,child_pid=0;
static void stop(int sig){interrupted=1;if(child_pid>0){kill(-child_pid,SIGKILL);kill(child_pid,SIGKILL);}}
/* A process can disappear between census and inspection. Only positively absent
 * or zombie processes resolve that race; a live/uninspectable PID fails. */
static int vanished(pid_t pid){
  if(kill(pid,0)<0)return errno==ESRCH;
  struct proc_bsdinfo info;
  /* Zombies can still answer kill(pid,0), while BSD-info reports ESRCH. */
  errno=0;
  int size=proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info));
  return size==sizeof(info)?info.pbi_status==5:errno==ESRCH;
}
static int inspect_identity(pid_t pid,const char *allow,const char *deny,Identity *identity) {
  if(pid<=0)return 0;
  /* Fast attempts only. Vanished (-2) is NOT a resolved census observation:
   * a successor can have been born after the snapshot. */
  for(int attempt=0;attempt<3;attempt++){
  struct proc_bsdinfo info;
  if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))!=sizeof(info)){if(vanished(pid))return -2;continue;}
  if(info.pbi_uid!=getuid()||pid==getpid())return 0;
  for(int i=0;i<before_count;i++)if(before[i].pid==pid&&before[i].seconds==info.pbi_start_tvsec&&before[i].micros==info.pbi_start_tvusec)return 0;
  if(info.pbi_status==5)return observed_dead(pid,&info);
  int a=sandbox_check(pid,"mach-lookup",2|SANDBOX_CHECK_NO_REPORT,allow);
  int d=sandbox_check(pid,"mach-lookup",2|SANDBOX_CHECK_NO_REPORT,deny);
  if(a<0||d<0){if(vanished(pid))return -2;continue;}
  /* sandbox_check on a dead PID may return DENIED, not an error. If the PID
   * exits between allow and deny, that pair falsely looks like our sandbox.
   * Bind BOTH policy answers to one live process identity after inspection. */
  struct proc_bsdinfo after;
  if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&after,sizeof(after))!=sizeof(after)){if(vanished(pid))return -2;continue;}
  if(after.pbi_status==5)return observed_dead(pid,&after);
  if(after.pbi_start_tvsec!=info.pbi_start_tvsec||after.pbi_start_tvusec!=info.pbi_start_tvusec)continue;
  if(a==0&&d>0){if(identity)*identity=(Identity){pid,info.pbi_start_tvsec,info.pbi_start_tvusec};return 1;}return 0;
  }
  return -1;
}
static int inspect(pid_t pid,const char *allow,const char *deny){return inspect_identity(pid,allow,deny,NULL);}
/* One aggregate monotonic budget for listing and inspection. Tests replace clock_gettime
 * at the call boundary. census_code records how the census ended: 0 after two consecutive
 * resolved clean passes, 3 listing unavailable, 5/7 a matched process could not be
 * stopped/killed, 18 budget exhausted (infrastructure, never an observed worker violation).
 * reap() returns the number of matched survivors stopped and killed whenever there were
 * any, even when the census then fails or exhausts its budget: an observed survivor is
 * never dropped. Otherwise 0 (clean) or -census_code. */
static int census_code=0,census_found=0;
static double census_now(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t)!=0)return -1;return t.tv_sec+t.tv_nsec/1e9;}
/* 5/7 outrank survivors: a matched process is still alive, so it is never reported as killed (90). */
static int settle(int code,int found){census_code=code;census_found=found;if(code==5||code==7)return -code;return found?found:-code;}
/* Every stopped match is re-verified and killed, even after the budget expires, so no
 * stopped survivor is left behind. Bounded by the snapshot size; inspect() never sleeps. */
static int kill_stopped(int matches,const char*allow,const char*deny,int*unresolved){
  int failed=0;
  for(int i=0;i<matches;i++){
    int match=inspect(stopped[i],allow,deny);
    if(match<0){*unresolved=1;continue;}
    if(match&&kill(stopped[i],SIGKILL)!=0&&errno!=ESRCH)failed=7;
  }
  return failed;
}
static int reap(const char*allow,const char*deny) {
  int found=0,clean=0;census_code=census_found=matched_count=matched_truncated=0;double start=census_now();if(start<0)return settle(18,found);
  for(int pass=0;pass<512;pass++) {
    int n=proc_listpids(PROC_UID_ONLY,getuid(),pids,sizeof(pids))/sizeof(pid_t),matches=0,unresolved=0,exhausted=0,stuck=0;
    if(n<=0||n>=65536)return settle(3,found);
    for(int i=0;i<n;i++) {
      double now=census_now();if(now<start||now-start>=10){exhausted=1;break;}
      Identity identity;int match=inspect_identity(pids[i],allow,deny,&identity);
      if(match<0){unresolved=1;continue;}if(!match)continue;
      if(kill(pids[i],SIGSTOP)!=0){if(errno!=ESRCH){stuck=1;break;}unresolved=1;continue;}
      stopped[matches++]=pids[i];retain_match(identity);
    }
    if(matches){found+=matches;clean=0;}
    int killed=kill_stopped(matches,allow,deny,&unresolved);
    if(killed)return settle(killed,found);
    if(stuck)return settle(5,found);
    if(exhausted)return settle(18,found);
    double now=census_now();if(now<start||now-start>=10)return settle(18,found);
    if(!matches&&!unresolved){if(++clean==2)return settle(0,found);}else clean=0;
    /* Yield once per unresolved SNAPSHOT, never per PID. Without this, a busy
     * census can spend its entire pass allowance before an exiting peer is
     * scheduled to reap its child. Bounded per-pass backoff uses the aggregate
     * deadline; the pass cap cannot busy-spin through a 10-second budget. */
    if(unresolved){double remaining=10-(now-start);long delay=pass<4?(1000000L<<pass):20000000L;long ns=remaining<delay/1e9?(long)(remaining*1e9):delay;struct timespec pause={0,ns};nanosleep(&pause,NULL);}
  }
  return settle(18,found);
}
int main(int argc,char **argv) {
  if(argc<5)return 2;
  int run=strcmp(argv[1],"--run")==0;
  if(run){
    if(argc<6)return 2;
    int n=proc_listpids(PROC_UID_ONLY,getuid(),pids,sizeof(pids))/sizeof(pid_t);if(n<=0||n>=65536)return 3;
    for(int i=0;i<n;i++){struct proc_bsdinfo b;if(proc_pidinfo(pids[i],PROC_PIDTBSDINFO,0,&b,sizeof(b))==sizeof(b)&&b.pbi_uid==getuid())before[before_count++]=(Identity){pids[i],b.pbi_start_tvsec,b.pbi_start_tvusec};}
    FILE*f=fopen(argv[4],"wb");if(!f)return 9;int ok=fwrite(before,sizeof(Identity),before_count,f)==before_count;fclose(f);if(!ok)return 10;
    struct sigaction sa={0};sa.sa_handler=stop;sigaction(SIGTERM,&sa,NULL);sigaction(SIGINT,&sa,NULL);
    pid_t pid=fork();if(pid<0)return 11;
    if(pid==0){setsid();execv(argv[5],argv+5);_exit(127);}
    child_pid=pid; if(interrupted)kill(-pid,SIGKILL);
    int status;while(waitpid(pid,&status,0)<0)if(errno!=EINTR)return 12;
    kill(-pid,SIGKILL);
    int cleaned=reap(argv[2],argv[3]);
    char result_path[4096];
    if(snprintf(result_path,sizeof(result_path),"%s.outcome",argv[4])>=(int)sizeof(result_path))return 15;
    FILE *result=fopen(result_path,"w");if(!result)return 16;
    /* survivors: matched processes stopped and killed; census: how the census ended. */
    fprintf(result,"{\"exitCode\":%d,\"signal\":%d,\"survivors\":%d,\"census\":%d,\"matched\":[",WIFEXITED(status)?WEXITSTATUS(status):-1,WIFSIGNALED(status)?WTERMSIG(status):0,census_found,census_code);
    for(int i=0;i<matched_count;i++)fprintf(result,"%s{\"pid\":%d,\"startSeconds\":%llu,\"startMicros\":%llu,\"executable\":\"%s\"}",i?",":"",matched[i].identity.pid,(unsigned long long)matched[i].identity.seconds,(unsigned long long)matched[i].identity.micros,matched[i].executable);
    fprintf(result,"],\"matchedTruncated\":%s}\n",matched_truncated?"true":"false");
    if(fclose(result)!=0)return 17;
    if(cleaned>0)return 90; // Observed detached survivor: killed, but execution fails closed, even if the census also failed.
    if(census_code)return census_code;
    if(interrupted)return 124;
    return WIFEXITED(status)&&WEXITSTATUS(status)==0?0:80;
  }
  FILE*f=fopen(argv[4],"rb");if(!f)return 13;before_count=fread(before,sizeof(Identity),65536,f);fclose(f);if(before_count<1)return 14;
  int cleaned=reap(argv[2],argv[3]);
  if(cleaned>0){printf("%d\n",cleaned);return 0;} // Survivors observed: never reported as clean.
  if(census_code)return census_code;
  printf("0\n");return 0;
}
