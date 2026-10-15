import { readFileSync } from 'node:fs';
/** Dated K-Dense MIT planning snapshot. These data do not assert current submission compliance. */
export interface PublisherProfile {
 readonly label:string;readonly scope:string;readonly sources:readonly string[];
 readonly widths_mm:Readonly<Record<string,number>>;readonly notes:readonly string[];
 readonly [key:string]:unknown;
}
export function publisherProfiles():Readonly<Record<string,PublisherProfile>> {
 const snapshot=JSON.parse(readFileSync(new URL('../vendor/publisher_profiles.json',import.meta.url),'utf8')) as {profiles:Record<string,PublisherProfile>};
 return structuredClone(snapshot.profiles);
}
