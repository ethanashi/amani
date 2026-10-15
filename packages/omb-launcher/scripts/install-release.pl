use strict;
use warnings;
use Digest::SHA qw(sha256_hex);
use File::Find;
use File::Path qw(remove_tree);
use File::Temp qw(tempdir);
use Cwd qw(abs_path);
use POSIX qw(geteuid);
use Fcntl qw(:DEFAULT O_NOFOLLOW O_NONBLOCK);

$| = 1;
delete @ENV{qw(IFS CDPATH ENV BASH_ENV PERL5LIB)};
$ENV{PATH} = '/usr/bin:/bin:/usr/sbin';

my $dry_run = @ARGV == 1 && $ARGV[0] eq '--dry-run-path-check';
my $test = @ARGV == 6 && $ARGV[3] eq '--test-root';
if (!$dry_run && !$test && geteuid() != 0) { print STDERR "requires uid 0\n"; exit 77; }
die "usage: staging pinned-manifest expected-sha256 [--test-root fake-root authority-uid]\n"
  unless $dry_run || @ARGV == 3 || $test;
my ($source, $pin, $expected) = $dry_run ? ('', '', '') : @ARGV[0..2];
unless ($dry_run) {
  die "unsafe source path\n" unless defined($source) && $source =~ m{^(/[A-Za-z0-9_/.+:\@=-]+)$}; $source = $1;
  die "unsafe pinned manifest path\n" unless defined($pin) && $pin =~ m{^(/[A-Za-z0-9_/.+:\@=-]+)$}; $pin = $1;
  die "bad expected digest\n" unless defined($expected) && $expected =~ /^([a-f0-9]{64})$/;
  $expected = $1;
}
my $fake;
my $test_authority_uid = 401;
if ($test) {
  die "unsafe fake root\n" unless $ARGV[4] =~ m{^(/[A-Za-z0-9_./+-]+)$} && $1 ne '/';
  $fake = $1;
  die "invalid test authority uid\n" unless $ARGV[5] =~ /^([0-9]+)$/ && $1 > 0 && $1 < 65536;
  $test_authority_uid = 0 + $1;
}
umask 0022;

my $ROOT = $test ? "$fake/usr/local/libexec/omb" : '/usr/local/libexec/omb';
my $AUTH = $test ? "$fake/var/db/omb-authority" : '/var/db/omb-authority';
my $SUDOERS = $test ? "$fake/etc/sudoers.d/omb-launcher" : '/etc/sudoers.d/omb-launcher';
my $uid = $test ? $< : 0;
my $gid = $test ? $) : 0;
$gid =~ s/ .*//;
my $owner_name = $test ? getpwuid($uid) : 'root';
my $group_name = $test ? getgrgid($gid) : 'wheel';
my %required = map { $_ => 1 } qw(bin/node omb-cert.mjs cert-launch run-launch run.sb omb.sudoers pixi.lock ARCHIVES.json runtime-prefix);
my $sudo_dir = parent_path($SUDOERS);

sub refuse { die "installer refused: $_[0]\n"; }
sub untaint_path {
  my ($path) = @_;
  refuse('unsafe filesystem path') unless defined($path) && $path =~ m{^(/[A-Za-z0-9_/.+:\@=-]+)$};
  return $1;
}
sub digest_file {
  my ($path) = @_;
  sysopen(my $fh, $path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK) or refuse('cannot read bound file');
  my @s = stat($fh); refuse('bound file type/link') unless @s && -f $fh && $s[3] == 1;
  my $sha = Digest::SHA->new(256); $sha->addfile($fh); close($fh);
  return $sha->hexdigest;
}
sub acl_refused {
  my ($path) = @_;
  my $safe = $path; refuse('unsafe ACL path') unless $safe =~ m{^(/[A-Za-z0-9_/.+:\@=-]+)$}; $safe = $1;
  open(my $fh, '-|', '/bin/ls', '-lde', $safe) or refuse("cannot inspect ACL: $!");
  local $/; my $listing = <$fh>; close($fh) or refuse("ACL inspection command failed: $?");
  refuse('ACL refused') if $listing =~ /^\S*\+/m || $listing =~ /^\s*\d+:\s/m;
}
sub safe_stat {
  my ($path, $owner, $mode, $strict_gid) = @_;
  my @s = lstat($path); refuse("missing or uninspectable path: $path") unless @s;
  refuse("symlink refused: $path") if -l _;
  refuse("owner/mode refused: $path") if $s[4] != $owner || ($strict_gid && $s[5] != 0) || ($s[2] & 0022) || (defined($mode) && ($s[2] & 07777) != $mode);
  acl_refused($path);
  return @s;
}
sub anchored_path {
  my ($path, $anchor) = @_;
  return 1 unless defined($anchor);
  return $path eq $anchor || index($path, "$anchor/") == 0;
}
sub check_physical_path {
  my ($path, $owner, $anchor) = @_;
  $path = untaint_path($path);
  refuse('resolved symlink escapes fake root') unless anchored_path($path, $anchor);
  my @parts;
  my $current = '';
  if (defined($anchor)) {
    safe_stat($anchor, $owner, undef, $owner == 0);
    @parts = grep { length($_) } split m{/+}, substr($path, length($anchor));
    $current = $anchor;
  } else { @parts = grep { length($_) } split m{/+}, $path; }
  for my $part (@parts) {
    $current .= "/$part";
    my @s = lstat($current); refuse('resolved path changed') unless @s;
    refuse('resolved path still contains symlink') if -l _;
    safe_stat($current, $owner, undef, $owner == 0);
  }
}
sub check_path_chain {
  my ($path, $owner, $anchor) = @_;
  $path = untaint_path($path);
  refuse('path escapes fake root') unless anchored_path($path, $anchor);
  my @parts;
  my $current = '';
  if (defined($anchor)) {
    safe_stat($anchor, $owner, undef, $owner == 0);
    @parts = grep { length($_) } split m{/+}, substr($path, length($anchor));
    $current = $anchor;
  } else { @parts = grep { length($_) } split m{/+}, $path; }
  for my $part (@parts) {
    $current .= "/$part";
    my @s = lstat($current);
    last unless @s; # Missing descendants are created only after this audit.
    if (-l _) {
      my $resolved = abs_path($current); refuse('unresolvable parent symlink') unless defined($resolved);
      $resolved = untaint_path($resolved);
      check_physical_path($resolved, $owner, $anchor);
      $current = $resolved;
      next;
    }
    safe_stat($current, $owner, undef, $owner == 0);
  }
}
sub parent_path { my ($path) = @_; my $slash = rindex($path, '/'); return $slash > 0 ? substr($path, 0, $slash) : '/'; }
sub audit_install_paths {
  my ($anchor) = @_;
  my $root_owner = $test ? $uid : 0;
  my $authority_owner = $test ? $test_authority_uid : 401;
  check_path_chain($ROOT, $root_owner, $anchor);
  check_path_chain(parent_path($AUTH), $root_owner, $anchor);
  safe_stat($AUTH, $authority_owner, 0700, 0);
  check_path_chain($sudo_dir, $root_owner, $anchor);
}
sub parse_manifest {
  my ($bytes) = @_;
  refuse('manifest size cap') if length($bytes) > 16 * 1024 * 1024;
  my $text = $bytes; $text =~ s/\n\z//;
  refuse('manifest syntax') unless $text =~ s/^\{// && $text =~ s/\}\z//;
  my %m; pos($text) = 0;
  while ($text =~ /\G(?:,)??"([A-Za-z0-9_.+\/@=-]+)":\{"mode":(420|493),"sha256":"([a-f0-9]{64})"\}/gc) {
    my ($name, $mode, $sha) = ($1, $2, $3);
    refuse('unsafe manifest path') if $name eq 'MANIFEST' || $name =~ m{^/|//|(?:^|/)\.{1,2}(?:/|$)};
    refuse('duplicate manifest path') if exists $m{$name};
    $m{$name} = { mode => 0 + $mode, sha256 => $sha };
  }
  refuse('manifest trailing bytes') unless (pos($text) // 0) == length($text);
  for my $name (keys %required) { refuse('missing required release file') unless exists $m{$name}; }
  return \%m;
}
sub inventory {
  my ($dir, $manifest) = @_;
  my %seen;
  my @root = lstat($dir); refuse('staging directory must be a real directory') unless @root && -d _ && !-l _;
  find({ no_chdir => 1, wanted => sub {
    my $p = $File::Find::name; return if $p eq $dir;
    my $rel = substr($p, length($dir) + 1); my @s = lstat($p); refuse('staging changed during inventory') unless @s;
    refuse('staged symlink refused') if -l _;
    acl_refused($p);
    return if -d _;
    refuse('staged nonregular/hardlink refused') unless -f _ && $s[3] == 1;
    refuse('extra staged file') if $rel eq 'MANIFEST' ? 0 : !exists($manifest->{$rel});
    $seen{$rel} = 1;
  }}, $dir);
  my @manifest_stat = lstat("$dir/MANIFEST"); refuse('staged manifest missing or unsafe') unless @manifest_stat && -f _ && !-l _ && $manifest_stat[3] == 1;
  acl_refused("$dir/MANIFEST"); $seen{MANIFEST} = 1;
  my %want = (%$manifest, MANIFEST => 1);
  refuse('extra or missing staged files') unless join("\0", sort keys %seen) eq join("\0", sort keys %want);
  for my $name (keys %$manifest) { refuse('missing staged file') unless $seen{$name}; }
}
# A content-addressed runtime can be shared across releases only after a complete
# ownership/mode/link/ACL/content/inventory audit. Never repair it in place.
sub verify_existing_runtime {
  my ($dir, $entries, $owner) = @_;
  safe_stat($dir, $owner, 0755, $owner == 0); refuse('runtime directory required') unless -d _;
  my %seen;
  find({ no_chdir => 1, wanted => sub {
    my $p = untaint_path($File::Find::name); return if $p eq $dir;
    my $rel = substr($p, length($dir) + 1);
    my @st = lstat($p); refuse('runtime changed during audit') unless @st;
    if (-d _ && !-l _) { safe_stat($p, $owner, 0755, $owner == 0); return; }
    refuse('extra runtime file') unless exists $entries->{$rel};
    my @checked = safe_stat($p, $owner, $entries->{$rel}{mode}, $owner == 0);
    refuse('runtime file type/link') unless -f _ && $checked[3] == 1;
    refuse('existing runtime content mismatch') unless digest_file($p) eq $entries->{$rel}{sha256};
    $seen{$rel} = 1;
  }}, $dir);
  refuse('missing runtime file') unless join("\0", sort keys %seen) eq join("\0", sort keys %$entries);
}
sub ensure_dir {
  my ($path, $owner, $group, $mode) = @_;
  if (lstat($path)) { safe_stat($path, $owner, $mode, $owner == 0); refuse('expected directory') unless -d _; return; }
  my $slash = rindex($path, '/'); my $parent = $slash > 0 ? substr($path, 0, $slash) : '/';
  ensure_dir($parent, $owner, $group, 0755) unless -d $parent;
  mkdir($path, $mode) or refuse('directory create failed');
  chown($owner, $group, $path) == 1 or refuse('directory ownership failed');
  chmod($mode, $path) == 1 or refuse('directory mode failed');
  safe_stat($path, $owner, $mode, $owner == 0);
}
sub copy_bound {
  my ($from, $to, $entry) = @_;
  sysopen(my $in, $from, O_RDONLY | O_NOFOLLOW | O_NONBLOCK) or refuse('staged source open refused');
  my @s = stat($in); refuse('staged source type/link refused') unless @s && -f $in && $s[3] == 1;
  my $slash = rindex($to, '/'); my $parent = $slash > 0 ? substr($to, 0, $slash) : '/'; ensure_dir($parent, $test ? $< : 0, $test ? $gid : 0, 0755) unless -d $parent;
  sysopen(my $out, $to, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, $entry->{mode}) or refuse('private copy create failed');
  while (1) {
    my $n = sysread($in, my $buffer, 1024 * 1024); defined($n) or refuse('staged source read failed'); last if $n == 0;
    my $offset = 0; while ($offset < $n) { my $w = syswrite($out, $buffer, $n - $offset, $offset); defined($w) && $w > 0 or refuse('private copy write failed'); $offset += $w; }
  }
  close($in); close($out) or refuse('private copy close failed');
  chown($test ? $< : 0, $test ? $gid : 0, $to) == 1 or refuse('private copy ownership failed'); chmod($entry->{mode}, $to) == 1 or refuse('private copy mode failed');
}

if ($dry_run) {
  audit_install_paths(undef);
  print "path-checks-passed: /usr/local/libexec/omb, /var/db/omb-authority, /etc/sudoers.d\n";
  if (geteuid() != 0) { print STDERR "stop: requires uid 0; dry-run made no writes\n"; exit 77; }
  print "stop: path-only dry-run complete; no writes performed\n"; exit 0;
}

# Pin validation is the first operation with an external effect. The staging
# MANIFEST is inventoried but never opened or used as a source of metadata.
my @pin_stat = lstat($pin);
refuse('pinned manifest type/owner/mode/link') unless @pin_stat && -f _ && !-l _ && $pin_stat[3] == 1 && $pin_stat[4] == ($test ? $uid : 0) && ($pin_stat[2] & 07777) == 0644;
acl_refused($pin);
my $raw; { sysopen(my $fh, $pin, O_RDONLY | O_NOFOLLOW | O_NONBLOCK) or refuse('pinned manifest open refused'); local $/; $raw = <$fh>; close($fh); }
refuse('pinned manifest digest mismatch') unless sha256_hex($raw) eq $expected;
my $manifest = parse_manifest($raw);
my @pw;
unless ($test) {
  for my $spec (['_ombcert', 401], ['_ombrun', 402]) {
    @pw = getpwnam($spec->[0]); refuse('service account mismatch') unless @pw && $pw[2] == $spec->[1] && $pw[3] == $spec->[1] && $pw[7] eq '/var/empty' && $pw[8] eq '/usr/bin/false';
  }
}
if ($test) {
  $fake = abs_path($fake); refuse('fake root could not be resolved') unless defined($fake); $fake = untaint_path($fake);
  $ROOT = "$fake/usr/local/libexec/omb"; $AUTH = "$fake/var/db/omb-authority"; $SUDOERS = "$fake/etc/sudoers.d/omb-launcher"; $sudo_dir = parent_path($SUDOERS);
}
audit_install_paths($test ? $fake : undef);
inventory($source, $manifest);

my %runtime = map { substr($_, 8) => $manifest->{$_} } grep { /^runtime\// } keys %$manifest;
my $runtime_inventory = join('', map { "$runtime{$_}{sha256} $runtime{$_}{mode} runtime/$_\n" } sort keys %runtime);
my $runtime_hash = sha256_hex($runtime_inventory); $runtime_hash =~ /^([a-f0-9]{64})$/ or refuse('runtime hash encoding'); $runtime_hash = $1;
my $expected_runtime = "$ROOT/runtime/$runtime_hash";
# The release always records the PRODUCTION prefix (binaries embed it); --test-root only relocates
# where files land, so a rehearsal can install the real, unmodified release into a fake root.
my $expected_prefix_text = "/usr/local/libexec/omb/runtime/$runtime_hash\n";
my $runtime_prefix;
{ sysopen(my $fh, "$source/runtime-prefix", O_RDONLY | O_NOFOLLOW | O_NONBLOCK) or refuse('runtime prefix open refused'); local $/; $runtime_prefix = <$fh>; close($fh); }
refuse('runtime prefix not content-bound') unless $runtime_prefix eq $expected_prefix_text;

my $root_owner = $test ? $uid : 0; my $root_group = $test ? $gid : 0;
my $reuse_runtime = lstat($expected_runtime) ? 1 : 0;
verify_existing_runtime($expected_runtime, \%runtime, $root_owner) if $reuse_runtime;
refuse('fake root must be an existing real directory') if $test && (!-d $fake || -l $fake);
ensure_dir($ROOT, $root_owner, $root_group, 0755);
audit_install_paths($test ? $fake : undef);
ensure_dir("$ROOT/releases", $root_owner, $root_group, 0755);
ensure_dir("$ROOT/bin", $root_owner, $root_group, 0755);
ensure_dir("$ROOT/runtime", $root_owner, $root_group, 0755);
my $release_id = sha256_hex($raw); $release_id =~ /^([a-f0-9]{64})$/ or refuse('release hash encoding'); $release_id = $1;
my $destination = "$ROOT/releases/$release_id";
refuse('release already exists; manual verification required') if lstat($destination);
my $private_tainted = tempdir('.install-XXXXXXXX', DIR => "$ROOT/releases", CLEANUP => 0);
$private_tainted =~ m{^(/[A-Za-z0-9_/.+:\@=-]+)$} or refuse('unsafe private directory path');
my $private = $1;
index($private, "$ROOT/releases/.install-") == 0 or refuse('private directory escaped release root');
chmod(0700, $private) == 1 or refuse('private directory mode failed');
my $private_release = "$private/release"; my $private_runtime = "$private/runtime";
mkdir($private_release, 0700) or refuse('private release mkdir failed');
mkdir($private_runtime, 0700) or refuse('private runtime mkdir failed');
my @checks;
for my $name (sort keys %$manifest) {
  if ($name =~ /^runtime\//) { my $relative = substr($name, 8); copy_bound("$source/$name", "$private_runtime/$relative", $manifest->{$name}); push @checks, "$manifest->{$name}{sha256}  runtime/$relative\n"; }
  else { copy_bound("$source/$name", "$private_release/$name", $manifest->{$name}); push @checks, "$manifest->{$name}{sha256}  release/$name\n"; }
}
{ open(my $sum, '>:raw', "$private/CHECKSUMS") or refuse('checksum list create failed'); print {$sum} @checks; close($sum) or refuse('checksum list close failed'); }
chdir($private) or refuse('private checksum cwd failed');
system('/usr/bin/shasum', '-a', '256', '-c', 'CHECKSUMS') == 0 or refuse('copied content hash mismatch');
chdir('/') or refuse('restore cwd failed');
{ open(my $mf, '>:raw', "$private_release/MANIFEST") or refuse('private manifest create failed'); print {$mf} $raw; close($mf) or refuse('private manifest close failed'); chmod(0644, "$private_release/MANIFEST"); chown($root_owner, $root_group, "$private_release/MANIFEST"); }
chmod(0755, $private_release); chmod(0755, $private_runtime);
if (!$reuse_runtime) { refuse('runtime appeared during installation') if lstat($expected_runtime); rename($private_runtime, $expected_runtime) or refuse('atomic runtime publish failed'); }
else { verify_existing_runtime($expected_runtime, \%runtime, $root_owner); }
rename($private_release, $destination) or refuse('atomic release publish failed');

{
  my $authority_owner = $test ? $test_authority_uid : 401;
  my $authority_group = $test ? $gid : 401;
  my $var_db = $test ? "$fake/var/db" : '/var/db';
  ensure_dir("$var_db/omb-stage", $authority_owner, $authority_group, 0755);
  ensure_dir("$var_db/omb-run-tmp", $test ? $uid : 402, $test ? $gid : 402, 0700);
  ensure_dir("$AUTH/tmp", $authority_owner, $authority_group, 0700);
  ensure_dir("$AUTH/requests", $authority_owner, $authority_group, 0700);
  for my $name ('seal.key', 'host.key') {
    my $key = "$AUTH/$name";
    if (!lstat($key)) { sysopen(my $random, '/dev/urandom', O_RDONLY) or refuse('random source unavailable'); my $bytes = ''; while (length($bytes) < 32) { my $n = sysread($random, my $part, 32 - length($bytes)); defined($n) && $n > 0 or refuse('random source failed'); $bytes .= $part; } close($random); sysopen(my $fd, $key, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600) or refuse('authority key create failed'); print {$fd} $bytes; close($fd); chown($authority_owner, $authority_group, $key); }
    my @ks = safe_stat($key, $authority_owner, 0600, 0); refuse('invalid authority key') unless -f _ && $ks[3] == 1 && $ks[7] == 32;
  }
}
for my $name ('cert-launch', 'run-launch') {
  my $tmp = "$ROOT/bin/.$name-$$";
  sysopen(my $fh, $tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0700) or refuse('wrapper create failed');
  print {$fh} "#!/bin/sh\nexec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/var/empty LANG=C /bin/sh $destination/$name \"\$@\"\n"; close($fh);
  chown($root_owner, $root_group, $tmp); chmod(0755, $tmp); rename($tmp, "$ROOT/bin/$name") or refuse('atomic wrapper publish failed');
}

if ($test) { ensure_dir("$fake/etc", $uid, $gid, 0755) unless -d "$fake/etc"; ensure_dir($sudo_dir, $uid, $gid, 0755) unless -d $sudo_dir; }
else { check_path_chain($sudo_dir, 0, undef); }
my $sudo_tmp = "$sudo_dir/.omb-launcher-$$";
copy_bound("$destination/omb.sudoers", $sudo_tmp, $manifest->{'omb.sudoers'});
system('/usr/bin/cmp', '-s', $sudo_tmp, "$destination/omb.sudoers") == 0 or refuse('sudoers bytes differ from pinned release');
if (!$test) { system('/usr/sbin/visudo', '-cf', $sudo_tmp) == 0 or refuse('visudo -cf refused sudoers'); }
my $had_old = lstat($SUDOERS) ? 1 : 0; my $backup = "$sudo_dir/.omb-backup-$$";
if ($had_old) { safe_stat($SUDOERS, $root_owner, undef, !$test); system('/bin/cp', $SUDOERS, $backup) == 0 or refuse('sudoers backup failed'); }
if ($test) { rename($sudo_tmp, $SUDOERS) or refuse('fake sudoers atomic install failed'); chmod(0440, $SUDOERS); chown($uid, $gid, $SUDOERS); }
else {
  if (system('/usr/bin/install', '-m', '0440', '-o', 'root', '-g', 'wheel', $sudo_tmp, $SUDOERS) != 0) { unlink($backup) if $had_old; refuse('sudoers install failed'); }
  if (system('/usr/sbin/visudo', '-c') != 0) {
    if ($had_old) { system('/usr/bin/install', '-m', '0440', '-o', 'root', '-g', 'wheel', $backup, $SUDOERS); } else { unlink($SUDOERS); }
    refuse('visudo -c failed; previous sudoers restored');
  }
  unlink($sudo_tmp);
}
unlink($backup) if $had_old;
my $current_tmp = "$ROOT/.current-$release_id";
symlink("releases/$release_id", $current_tmp) or refuse('current link create failed');
rename($current_tmp, "$ROOT/current") or refuse('atomic current link publish failed');
remove_tree($private, { safe => 1 });
refuse('private install cleanup failed') if lstat($private);
print "Installed manifest $release_id\n";
