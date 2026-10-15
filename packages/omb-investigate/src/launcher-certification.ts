import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { createClient, parseCertifyRequest, verifyResult, type CertifyWireRequest } from '../../omb-launcher/src/index.ts';
import type { CertifyPort, CertifyRequest, CertifyResult } from './ports.ts';

/** A ticket ID and artifact inventory must be supplied by the authority-side preparation port.
 * No local fallback may reinterpret a refused authority certificate as a passed gate. */
export class LauncherCertification implements CertifyPort {
  constructor(private readonly ports: {
    publicKey: string;
    releaseHash: string;
    prepare: (request: CertifyRequest) => Promise<CertifyWireRequest>;
    client?: ReturnType<typeof createClient>;
  }) {}
  async certify(request: CertifyRequest): Promise<CertifyResult> {
    const wire = await this.ports.prepare(request);
    parseCertifyRequest(wire);
    const reply = await (this.ports.client ?? createClient())('certify', wire);
    const result = verifyResult<{
      ticket: string; binding: { planHash: string; inputManifestHash: string; frozenCodeHash: string; executionId: string; contractHash?: string };
      claims: CertifyResult['claims']; metrics: CertifyResult['metrics']; gates: CertifyResult['gates']; separation: string;
    }>(reply.result, this.ports.publicKey, this.ports.releaseHash, canonicalSha256(wire));
    if (result.ticket !== wire.ticket || result.binding.planHash !== request.lock.planHash || result.binding.inputManifestHash !== request.expectedInputHash || result.binding.frozenCodeHash !== request.expectedCodeHash || result.binding.executionId !== request.executionId || result.binding.contractHash !== request.expectedContractHash || !Array.isArray(result.claims) || !Array.isArray(result.gates)) throw new Error('authority certificate differs from investigation pins');
    if (!request.osUserSeparation || request.degraded || result.separation !== 'OS-user separation') {
      // This is a monotone receiving-side cap: a valid signature cannot change the caller's mode.
      result.claims = result.claims.map(c => ['confirmed', 'replicated', 'refuted'].includes(c.status) ? {
        ...c, status: c.status === 'refuted' ? 'insufficient-evidence' : 'tentative', taskStatus: c.status === 'refuted' ? 'insufficient-evidence' : 'tentative',
        limitations: [...c.limitations, 'OS-user separation not established for this investigation'],
      } : c);
    }
    return { claims: result.claims, metrics: result.metrics, gates: result.gates, multiplicity: [], warnings: [], report: result.claims.map(c => `${c.claimId}: ${c.status}`).join('\n') };
  }
}
