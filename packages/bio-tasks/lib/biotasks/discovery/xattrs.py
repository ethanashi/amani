"""No-follow xattrs, including macOS Python builds without os.*xattr support."""
import ctypes
import os
import sys

if hasattr(os, 'listxattr'):
    def names(path): return os.listxattr(path, follow_symlinks=False)
    def get(path, name): return os.getxattr(path, name, follow_symlinks=False)
    def remove(path, name): os.removexattr(path, name, follow_symlinks=False)
    def set_value(path, name, value): os.setxattr(path, name, value, follow_symlinks=False)
elif sys.platform == 'darwin':
    libc = ctypes.CDLL(None, use_errno=True)
    libc.listxattr.argtypes = [ctypes.c_char_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
    libc.listxattr.restype = ctypes.c_ssize_t
    libc.getxattr.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint32, ctypes.c_int]
    libc.getxattr.restype = ctypes.c_ssize_t
    libc.removexattr.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
    libc.setxattr.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint32, ctypes.c_int]

    def checked(result):
        if result < 0:
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code))
        return result

    def names(path):
        path = os.fsencode(path)
        size = checked(libc.listxattr(path, None, 0, 1))
        buf = ctypes.create_string_buffer(size)
        n = checked(libc.listxattr(path, buf, size, 1))
        return [os.fsdecode(x) for x in buf.raw[:n].split(b'\0') if x]

    def get(path, name):
        path, name = os.fsencode(path), os.fsencode(name)
        size = checked(libc.getxattr(path, name, None, 0, 0, 1))
        buf = ctypes.create_string_buffer(size)
        n = checked(libc.getxattr(path, name, buf, size, 0, 1))
        return buf.raw[:n]

    def remove(path, name):
        checked(libc.removexattr(os.fsencode(path), os.fsencode(name), 1))

    def set_value(path, name, value):
        checked(libc.setxattr(os.fsencode(path), os.fsencode(name), value, len(value), 0, 1))
else:
    def unavailable(*_): raise ValueError('xattr inspection unavailable')
    names = get = remove = set_value = unavailable
