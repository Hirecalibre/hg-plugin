/* eslint-disable
  @typescript-eslint/no-unsafe-argument,
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/restrict-template-expressions,
  @typescript-eslint/no-unsafe-call,
  sf-plugin/no-missing-messages
  */

import path = require('path');
import {
  AuthInfo,
  Connection,
  Org,
  ScratchOrgCreateResult,
  SfError,
  SfProject,
  User,
  UserFields,
} from '@salesforce/core';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import {
  ComponentSet,
  ComponentStatus,
  type DeployResult,
  type FileResponse,
  type FileResponseFailure,
  type MetadataApiDeploy,
} from '@salesforce/source-deploy-retrieve';

import { DeployProgress } from '../../../libs/DeployProgress';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@hiregenius/hg-plugin', 'hg.create.dev');

export type HgCreateDevResult = {
  scratch: {
    username: string | undefined;
    id: string | undefined;
    durationDays: number | undefined;
    loginUrl: string | undefined;
  };
  failedFiles: FileResponseFailure[];
};

export type HgFlag = {
  'target-dev-hub': Org;
  alias: string;
  duration: number;
};

export default class HgCreateDev extends SfCommand<HgCreateDevResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-dev-hub': Flags.requiredOrg({
      summary: messages.getMessage('flags.target-dev-hub.summary'),
      required: true,
    }),
    alias: Flags.string({
      summary: messages.getMessage('flags.alias.summary'),
      char: 'a',
      default: 'dev',
    }),
    duration: Flags.integer({
      summary: messages.getMessage('flags.duration.summary'),
      char: 'y',
      default: 7,
    }),
  };

  public async run(): Promise<HgCreateDevResult> {
    const { flags } = await this.parse(HgCreateDev);
    const devHub: Org = flags['target-dev-hub'];

    const project = await SfProject.resolve();
    const projectJson = await project.resolveProjectConfig();
    const scratchOrg: ScratchOrgCreateResult = await this.createScratchOrg(devHub, flags);
    const deploy: MetadataApiDeploy = await this.prepareSource(
      scratchOrg?.username ?? '',
      projectJson.sourceApiVersion as string
    );
    const failedFiles = await this.pushSource(deploy);

    await this.assignPermissionSets(scratchOrg.authInfo as AuthInfo, scratchOrg.username as string, [
      'Core_Platform_Consultant',
    ]);

    return {
      scratch: {
        id: scratchOrg.scratchOrgInfo?.Id,
        username: scratchOrg.username,
        durationDays: scratchOrg.scratchOrgInfo?.DurationDays,
        loginUrl: scratchOrg.scratchOrgInfo?.LoginUrl,
      },
      failedFiles,
    };
  }

  private async createScratchOrg(devHub: Org, flags: HgFlag): Promise<ScratchOrgCreateResult> {
    this.spinner.start('Creating Scratch Org ');
    const scratchOrg: ScratchOrgCreateResult = await devHub.scratchOrgCreate({
      alias: flags.alias,
      durationDays: flags.duration,
      definitionfile: path.resolve('config/project-scratch.json'),
      noancestors: true,
    });
    this.spinner.stop();
    this.log(`Created org: ${scratchOrg.username}`);

    return scratchOrg;
  }

  private async prepareSource(username: string, sourceApiVersion: string): Promise<MetadataApiDeploy> {
    this.spinner.start('Preparing sources ');

    const deployComponentSet: ComponentSet = ComponentSet.fromSource(path.resolve('force-app/main/default'));
    deployComponentSet.sourceApiVersion = sourceApiVersion;

    const deploy: MetadataApiDeploy = await deployComponentSet.deploy({
      usernameOrConnection: username,
    });
    this.spinner.stop();

    return deploy;
  }

  private async pushSource(deploy: MetadataApiDeploy): Promise<FileResponseFailure[]> {
    const deploymentProgress = new DeployProgress(deploy);

    deploymentProgress.start();

    const result: DeployResult = await deploy.pollStatus();
    const deploymentResultFiles = result.getFileResponses();

    if (deploymentResultFiles.some((file) => file.state === ComponentStatus.Failed)) {
      const failedFiles = deploymentResultFiles
        .filter((file: FileResponse) => file.state === ComponentStatus.Failed)
        .map((file: FileResponse) => {
          const lineNumber: number = (file as FileResponseFailure).lineNumber ?? 0;
          const columnNumber: number = (file as FileResponseFailure).columnNumber ?? 0;

          return {
            component: `${file.type}/${file.fullName}`,
            location: `${lineNumber}:${columnNumber}`,
            error: (file as FileResponseFailure).error,
          };
        });

      const columns = {
        component: {},
        location: {
          minWidth: 7,
        },
        error: {},
      };

      this.table(failedFiles, columns);

      throw new SfError('Deployment failed', 'Deployment failed');
    }

    this.log('Source pushed successfully');

    return deploymentResultFiles.filter(
      (file: FileResponse) => file.state === ComponentStatus.Failed
    ) as FileResponseFailure[];
  }

  private async assignPermissionSets(authInfo: AuthInfo, username: string, permsets: string[]): Promise<void> {
    this.spinner.start('Assigning permission set(s) ');

    const connection: Connection = await Connection.create({ authInfo });
    const org = await Org.create({ connection });
    const user: User = await User.create({ org });
    const fields: UserFields = await user.retrieve(username);
    await user.assignPermissionSets(fields.id, permsets);

    this.spinner.stop();
  }
}
