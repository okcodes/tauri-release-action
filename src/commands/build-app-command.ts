import * as core from '@actions/core'
import { getRequiredEnvVars } from '../lib/github-utils/github-env-vars'
import { build, targetFromBuildOptions } from '../lib/tauri-utils/tauri-builder'
import { parseTauriCargoTomlFileInContext } from '../lib/rust-utils/get-rust-app-info'
import { tagNameFromTemplate } from '../lib/github-utils/tag-template'
import { getOrCreateGitHubRelease } from '../lib/github-utils/github-release'
import { uploadAppToGithub } from '../lib/tauri-utils/tauri-github-uploader'

export type BuildAppActionInputs = 'tauriContext' | 'buildOptions' | 'expectedArtifacts' | 'tagTemplate' | 'prerelease' | 'draft'
export type BuildAppActionOutputs = 'appName' | 'appVersion' | 'tag'

const input = (name: BuildAppActionInputs, options: core.InputOptions): string => core.getInput(name, options)
const booleanInput = (name: BuildAppActionInputs, options: core.InputOptions): boolean => core.getBooleanInput(name, options)
const output = (name: BuildAppActionOutputs, value: string): void => core.setOutput(name, value)

export const runBuildAppCommand = async (): Promise<void> => {
  console.log(`Running Build App Command`)

  try {
    const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA } = getRequiredEnvVars()

    if (!GITHUB_TOKEN) {
      core.setFailed('GITHUB_TOKEN is required')
      return
    }

    if (!GITHUB_REPOSITORY) {
      core.setFailed('GITHUB_REPOSITORY is required')
      return
    }

    const [owner, repo] = GITHUB_REPOSITORY.split('/')

    if (!owner || !repo) {
      core.setFailed('GITHUB_REPOSITORY must be called with the format owner/repo')
      return
    }

    if (!GITHUB_SHA) {
      core.setFailed('GITHUB_SHA is required')
      return
    }

    const tauriContext = input('tauriContext', { required: true, trimWhitespace: true })
    const buildOptions = input('buildOptions', { required: false, trimWhitespace: true })
    const expectedArtifacts = +input('expectedArtifacts', { required: true, trimWhitespace: true })
    const tagTemplate = input('tagTemplate', { required: true, trimWhitespace: true })
    const prerelease = booleanInput('prerelease', { required: true, trimWhitespace: true })
    const draft = booleanInput('draft', { required: true, trimWhitespace: true })

    // Validate amount of artifacts
    if (isNaN(expectedArtifacts) || expectedArtifacts <= 0) {
      core.setFailed('The input "expectedArtifacts" must be a number greater or equal to 1.')
      return
    }

    // Validate build options
    if (!targetFromBuildOptions(buildOptions)) {
      core.setFailed('The buildOptions must contain a flag --target (or -t) specifying the rust target triple to build')
      return
    }

    // Debug logs (core.debug("msg")) are only output if the `ACTIONS_STEP_DEBUG` secret is true
    console.log('Action called with:', { owner, repo, GITHUB_SHA, GITHUB_REPOSITORY })
    const appInfo = await parseTauriCargoTomlFileInContext(tauriContext)
    const tag = tagNameFromTemplate(tagTemplate, { appInfo, gitSha: GITHUB_SHA })

    const { uploadUrl } = await getOrCreateGitHubRelease({ githubToken: GITHUB_TOKEN, repo, owner, tag, sha: GITHUB_SHA, prerelease, draft })
    const { target: rustTarget } = await build(tauriContext, buildOptions)
    const { name: appName, version: appVersion } = appInfo.package
    await uploadAppToGithub({ uploadUrl, appVersion, githubToken: GITHUB_TOKEN, appName, tauriContext, rustTarget, expectedArtifacts })

    output('appName', appName)
    output('appVersion', appVersion)
    output('tag', tag)
  } catch (error) {
    // Fail the workflow run if an error occurs
    core.setFailed((error as Error).message)
  }
}
