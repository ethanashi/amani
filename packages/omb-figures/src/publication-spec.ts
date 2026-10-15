/** PW3b fixed layouts. Every numeric field is a certified fact/series ID, never a value.
 * PRISMA names follow the MIT PRISMA2020 schema; the official new-review template supplies attributed wording and phase layout.
 */
export interface PublicationBase { readonly id: string; readonly claimIds: readonly string[]; readonly title: string }
export interface IntervalRow { readonly label: string; readonly estimate: string; readonly lower: string; readonly upper: string; readonly weight: string }
export interface MetaForestSpec extends PublicationBase {
  readonly kind: 'meta-forest'; readonly outcome: string; readonly model: string; readonly iSquared: string; readonly tauSquared: string; readonly heterogeneityP: string;
  /** Certified entity with exactly 'lower' or 'higher': beneficial direction of the declared measure. */
  readonly benefitDirection: string; readonly rowGridlines?: boolean;
  readonly rows: readonly (IntervalRow & { readonly eventsTreatment: string; readonly totalTreatment: string; readonly eventsControl: string; readonly totalControl: string })[];
  readonly pooled: IntervalRow;
}
export interface FunnelSpec extends PublicationBase { readonly kind: 'funnel'; readonly estimates: string; readonly standardErrors: string; readonly pooled: string }
export interface SurrogacySpec extends PublicationBase {
  readonly kind: 'surrogacy'; readonly x: string; readonly y: string; readonly weights: string;
  readonly fitX: string; readonly fitY: string; readonly confidenceLower: string; readonly confidenceUpper: string;
  readonly predictionLower: string; readonly predictionUpper: string; readonly threshold: string;
  readonly model: string; readonly rSquared: string; readonly rSquaredLower: string; readonly rSquaredUpper: string;
}
export interface LeaveOneOutSpec extends PublicationBase { readonly kind: 'mr-leave-one-out'; readonly rows: readonly IntervalRow[]; readonly pooled: IntervalRow }
export interface PrismaExclusion { readonly reason: string; readonly count: string }
/** Matching PW5b port: counts reference authenticated count facts; reports and studies stay distinct. */
export interface PrismaFlowData {
  readonly database_results: string; readonly register_results: string; readonly duplicates: string;
  readonly excluded_automatic: string; readonly excluded_other: string; readonly records_screened: string;
  readonly records_excluded: string; readonly dbr_sought_reports: string; readonly dbr_notretrieved_reports: string;
  readonly dbr_assessed: string; readonly dbr_excluded: readonly PrismaExclusion[];
  readonly new_studies: string; readonly new_reports: string; readonly total_studies: string; readonly total_reports: string;
  readonly previous?: { readonly previous_studies: string; readonly previous_reports: string };
  readonly other?: { readonly website_results: string; readonly organisation_results: string; readonly citations_results: string;
    readonly other_sought_reports: string; readonly other_notretrieved_reports: string; readonly other_assessed: string;
    readonly other_excluded: readonly PrismaExclusion[] };
}
export interface PrismaSpec extends PublicationBase { readonly kind: 'prisma'; readonly flow: PrismaFlowData }
export interface RegionalSpec extends PublicationBase {
  readonly kind: 'regional'; readonly positions: string; readonly pValues: string; readonly ld: string;
  readonly variants: string; readonly leadIndex: string; readonly chromosome: string; readonly genomeBuild:string; readonly ldPopulation:string;
  readonly recombinationPositions: string; readonly recombinationRates: string;
  readonly genes: readonly { readonly label: string; readonly start: string; readonly end: string; readonly strand: string; readonly exonStarts:string; readonly exonEnds:string }[];
}
export interface UmapSpec extends PublicationBase { readonly kind: 'umap'; readonly x: string; readonly y: string; readonly groups: string; readonly groupLabels: string }
export interface ArchitectureSpec extends PublicationBase {
  readonly kind: 'architecture'; readonly nodes: readonly { readonly id: string; readonly label: string; readonly icon: 'bio' | 'health' }[];
  readonly edges: readonly { readonly from: string; readonly to: string; readonly assumption?: boolean }[];
}
export type PublicationSpec = MetaForestSpec | FunnelSpec | SurrogacySpec | LeaveOneOutSpec | PrismaSpec | RegionalSpec | UmapSpec | ArchitectureSpec;
