// Copyright (c) 2026 Ethan Ashihundu
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
export function canonicalJson(value) {
    if (value === null)
        return "null";
    if (typeof value === "string" || typeof value === "boolean")
        return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error("canonical JSON cannot encode non-finite numbers");
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (typeof value === "object") {
        const record = value;
        const entries = Object.keys(record)
            .sort()
            .map((key) => {
            const entry = record[key];
            if (entry === undefined)
                throw new Error("canonical JSON cannot encode undefined");
            return `${JSON.stringify(key)}:${canonicalJson(entry)}`;
        });
        return `{${entries.join(",")}}`;
    }
    throw new Error(`canonical JSON cannot encode ${typeof value}`);
}
export function sha256Canonical(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
/** Compatibility names retained while the crash-qualified donor kernel is extracted. */
export const canonicalSha256 = sha256Canonical;
export function canonicalClone(value) {
    return JSON.parse(canonicalJson(value));
}
export function assert(condition, message) {
    if (!condition)
        throw new Error(`PW9: ${message}`);
}
export function safePath(p) {
    assert(typeof p === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(p) && !p.split('/').some(x => x === '..' || x === '.' || x === ''), `unsafe relative path: ${p}`);
    return p;
}
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
