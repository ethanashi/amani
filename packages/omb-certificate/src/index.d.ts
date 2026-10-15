export declare function canonicalJson(value: unknown): string;
export declare function sha256Canonical(value: unknown): string;
/** Compatibility names retained while the crash-qualified donor kernel is extracted. */
export declare const canonicalSha256: typeof sha256Canonical;
export declare function canonicalClone<T>(value: T): T;
/** Public transport format. Gate evidence remains opaque to the transport verifier. */
export interface BundleManifest {
    schema: 'omb/bundle-manifest@1';
    files: Record<string, string>;
}
export interface PackageCertificate {
    schema: 'omb/package-certificate@1';
    paperInputHash: string;
    skeletonHash: string;
    bundleHash: string;
    gauntletVersion: string;
    calibrationId: string;
    gateResults: unknown;
    packagingGates: unknown;
    endorsement: unknown;
    review: unknown;
    [key: string]: unknown;
}
export declare function assert(condition: unknown, message: string): asserts condition;
export declare function safePath(p: string): string;
export declare const sha256: (bytes: string | Uint8Array) => string;
