import { type KeyObject } from 'node:crypto';
/** Authenticate the supplied trusted public key independently. This checks transport
 * integrity, not scientific validity or a new execution of the certification gates. */
export declare function verifyBundle(root: string, trustedKey: KeyObject): void;
