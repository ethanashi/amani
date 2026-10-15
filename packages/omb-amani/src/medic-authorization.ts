/** One explicit authorization decision for all temporary repair capabilities.
 * Unknown/nonempty CI values fail closed; launchers can only remove authorization. */
export function developmentAuthorized(requested=false,env:NodeJS.ProcessEnv=process.env):boolean {
  const truthy=(value:string|undefined)=>!!value?.trim()&&!/^(?:0|false|no|off)$/i.test(value.trim());
  if(!(requested||env.AMANI_MEDIC==='1'))return false;
  if((!!env.NODE_ENV&&!['development','test'].includes(env.NODE_ENV.toLowerCase()))||truthy(env.AMANI_RELEASE)||truthy(env.AMANI_DESKTOP)||process.versions.electron)return false;
  if(env.AMANI_LAUNCHER && env.AMANI_LAUNCHER!=='development')return false;
  if(Object.entries(env).some(([key,value])=>/^(?:CI|CONTINUOUS_INTEGRATION|GITHUB_ACTIONS|GITLAB_CI|BUILDKITE|TF_BUILD|JENKINS_URL|TEAMCITY_VERSION|CIRCLECI|TRAVIS|APPVEYOR|CODEBUILD_BUILD_ID|BUILD_BUILDID|DRONE|GITEA_ACTIONS|BITBUCKET_BUILD_NUMBER|JENKINS_HOME|HUDSON_URL|BAMBOO_BUILDKEY|SEMAPHORE|CI_NAME)$/.test(key)&&truthy(value)))return false;
  return true;
}
export function assertDevelopmentAuthorization(requested=false):void {
  if(!developmentAuthorized(requested))throw new Error('explicit development authorization required for medic capability');
}
