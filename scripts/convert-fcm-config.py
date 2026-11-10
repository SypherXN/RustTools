#!/usr/bin/env python3
"""Convert native RustPlusApi FCM credentials to the RustTools upload shape.

Input {"Gcm":{"AndroidId":<ulong>,"SecurityToken":<ulong>},...}; output contains
only fcm_credentials.gcm.androidId/securityToken as exact decimal strings. The
output is created exclusively (never overwritten) with owner-only mode where the
platform honours it; on Windows keep both files in a user-private folder.
"""
import argparse
import json
import os
import sys

MAX_U64 = 18446744073709551615
SUCCESS = "Converted; upload the output file to RustTools. Keep both files private."


class Invalid(ValueError):
    pass


def credential(value):
    if isinstance(value, int) and not isinstance(value, bool):
        number = value
    elif isinstance(value, str) and value.isascii() and value.isdigit():
        number = int(value)
    else:
        raise Invalid
    if not 0 < number <= MAX_U64:
        raise Invalid
    return str(number)


def convert(obj):
    gcm = obj.get("Gcm") if type(obj) is dict else None
    if type(gcm) is not dict or "AndroidId" not in gcm or "SecurityToken" not in gcm:
        raise Invalid
    return {"fcm_credentials": {"gcm": {
        "androidId": credential(gcm["AndroidId"]),
        "securityToken": credential(gcm["SecurityToken"])}}}


def convert_bytes(data):
    try:
        obj = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        raise Invalid
    return json.dumps(convert(obj), separators=(",", ":")) + "\n"


def write_new(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
    except Exception:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise


def self_test():
    assert __debug__, "self-test needs asserts enabled (do not use python -O)"
    native = ('{"Gcm":{"AndroidId":18446744073709551615,'
              '"SecurityToken":9007199254740993},"Fcm":{"Token":"t"},"ExpoPushToken":null}')
    expected = ('{"fcm_credentials":{"gcm":{"androidId":"18446744073709551615",'
                '"securityToken":"9007199254740993"}}}\n')
    assert convert_bytes(native.encode()) == expected
    assert convert_bytes(("\ufeff" + native).encode()) == expected
    strings = '{"Gcm":{"AndroidId":"9007199254740993","SecurityToken":"18446744073709551615"}}'
    assert convert_bytes(strings.encode()) == (
        '{"fcm_credentials":{"gcm":{"androidId":"9007199254740993",'
        '"securityToken":"18446744073709551615"}}}\n')
    bad = ("[]", '{"Gcm":[]}', '{"Gcm":{}}',
           '{"Gcm":{"AndroidId":1}}', '{"Gcm":{"SecurityToken":1}}',
           '{"Gcm":{"AndroidId":true,"SecurityToken":1}}',
           '{"Gcm":{"AndroidId":1.0,"SecurityToken":1}}',
           '{"Gcm":{"AndroidId":0,"SecurityToken":1}}',
           '{"Gcm":{"AndroidId":-1,"SecurityToken":1}}',
           '{"Gcm":{"AndroidId":18446744073709551616,"SecurityToken":1}}',
           '{"Gcm":{"AndroidId":"18446744073709551616","SecurityToken":1}}',
           '{"Gcm":{"AndroidId":"12a","SecurityToken":1}}',
           '{"Gcm":{"AndroidId":"0","SecurityToken":1}}')
    for text in bad:
        try:
            convert_bytes(text.encode())
        except Invalid:
            continue
        assert False, "invalid synthetic input was accepted"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", help="native credentials JSON")
    parser.add_argument("output", nargs="?", help="new file to create")
    parser.add_argument("--self-test", action="store_true", help="run checks; no files")
    args = parser.parse_args(argv)
    if args.self_test:
        self_test()
        print("Self-test passed.")
        return 0
    if not args.input or not args.output:
        parser.error("INPUT and OUTPUT are required unless --self-test is used")
    try:
        with open(args.input, "rb") as handle:
            text = convert_bytes(handle.read())
    except OSError:
        print("error: cannot read input", file=sys.stderr)
        return 1
    except Invalid:
        print("error: invalid credentials JSON", file=sys.stderr)
        return 1
    except Exception:
        print("error: conversion failed", file=sys.stderr)
        return 1
    try:
        write_new(args.output, text)
    except OSError:
        print("error: cannot create output (must be new, not the input)", file=sys.stderr)
        return 1
    print(SUCCESS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
