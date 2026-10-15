/* Replace conda's R shell frontend with exec-only forwarding. Rscript remains
 * the archive-pinned binary. No shell, PATH lookup, fork, user startup, or network.
 * The trusted runner supplies R_HOME and uses this fixed installed path. */
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  (void)argc;
  char executable[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0) return 70;
  char *slash = strrchr(executable, '/');
  if (!slash || (size_t)(slash - executable) + sizeof("/exec/R") >= sizeof(executable)) return 72;
  strcpy(slash, "/exec/R");
  argv[0] = executable;
  execv(executable, argv);
  return 73;
}
