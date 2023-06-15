/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-unsafe-call */

import { Connection, Org, ScratchOrgCreateResult, SfError, SfProject, User, UserFields } from '@salesforce/core';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import {
  ComponentSet,
  ComponentStatus,
  DeployResult,
  FileResponse,
  MetadataApiDeploy,
} from '@salesforce/source-deploy-retrieve';
import { DeployProgress } from '../../../libs/DeployProgress';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('hg-plugin', 'hg.create.dev');

export type HgCreateDevResult = {
  scratch: {
    username: string | undefined;
    id: string | undefined;
    durationDays: number | undefined;
    loginUrl: string | undefined;
  };
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
    let scratchOrg: ScratchOrgCreateResult;

    const project = await SfProject.resolve();
    const projectJson = await project.resolveProjectConfig();
    // console.log(project);
    // console.log(projectJson.sourceApiVersion);

    try {
      this.spinner.start('Creating Scratch Org ');
      scratchOrg = await devHub.scratchOrgCreate({
        alias: flags.alias,
        durationDays: flags.duration,
        definitionfile: '/Users/matt/Hiregenius/rpaas/config/project-scratch.json',
        // orgConfig: ,
        // orgConfig: {
        //   edition: 'enterprise',
        // },
        noancestors: true,
        apiversion: projectJson.sourceApiVersion,
      });
      this.spinner.stop();
      this.log(`Created org: ${scratchOrg.username}`);
    } catch (error) {
      this.error(error.getMessage());
      throw error;
    }

    // this.progress.start(0, {}, { title: 'Deploying source' });

    const username: string = scratchOrg?.username ?? '';
    const deployComponentSet: ComponentSet = ComponentSet.fromSource(
      '/Users/matt/Hiregenius/rpaas/force-app/main/default'
    );
    deployComponentSet.sourceApiVersion = projectJson.sourceApiVersion;

    const deploy: MetadataApiDeploy = await deployComponentSet.deploy({
      usernameOrConnection: username,
      apiVersion: projectJson.sourceApiVersion,
    });
    // deploy.onUpdate((response: MetadataApiDeployStatus) => {
    //   const { status, numberComponentsDeployed, numberComponentsTotal } = response;
    //   this.progress.setTotal(numberComponentsTotal);
    //   this.progress.update(numberComponentsDeployed);

    //   // const progress = `${numberComponentsDeployed}/${numberComponentsTotal}`;
    //   // const message = `Status: ${status} Progress: ${progress}`;

    //   // console.log(message);
    // });

    const deploymentProgress = new DeployProgress(deploy);
    // // Wait for polling to finish and get the DeployResult object
    deploymentProgress.start();
    const result: DeployResult = await deploy.pollStatus();
    // this.progress.finish();

    const deploymentResultFiles = result.getFileResponses();

    if (deploymentResultFiles.some((file) => file.state === ComponentStatus.Failed)) {
      const failedFiles = deploymentResultFiles
        .filter((file: FileResponse) => file.state === ComponentStatus.Failed)
        .map((file) => ({
          component: `${file.type}/${file.fullName}`,
          location: `${file.lineNumber || 0}:${file.columnNumber || 0}`,
          error: file.error,
        }));

      const columns = {
        // where `.name` is a property of a data object
        component: {}, // "Name" inferred as the column header
        location: {
          minWidth: 7,
        },
        error: {}, // "Name" inferred as the column header
      };

      this.table(failedFiles, columns);

      // {
      //   fullName: 'PlacementSelector',
      //   type: 'ApexClass',
      //   state: 'Failed',
      //   error: 'CurrencyIsoCode,\n' +
      //     '                        ^\n' +
      //     'ERROR at Row:6:Column:25\n' +
      //     "No such column 'CurrencyIsoCode' on entity 'rpaas_core__Placement__c'. If you are attempting to use a custom field, be sure to append the '__c' after the custom field name. Please reference your WSDL or the describe call for the appropriate names. (500:16)",
      //   problemType: 'Error',
      //   filePath: '/Users/matt/Hiregenius/rpaas/force-app/main/default/classes/selectors/PlacementSelector.cls',
      //   lineNumber: 500,
      //   columnNumber: 16
      // },

      throw new SfError('Deployment failed', 'Deployment failed');
    }

    this.log('Source pushed successfully');

    // Output each file along with its state change of the deployment
    // console.log(JSON.stringify(result.getFileResponses(), null, 2));
    // @TODO: check for failed file deployment if yes print errors

    this.spinner.start('Assigning permission set(s) ');
    // const username = 'user@example.com';
    const connection: Connection = await Connection.create({
      authInfo: scratchOrg.authInfo, // await AuthInfo.create({ username })
    });
    const org = await Org.create({ connection });
    const user: User = await User.create({ org });
    const fields: UserFields = await user.retrieve(scratchOrg.username);
    await user.assignPermissionSets(fields.id, ['Core_Platform_Consultant']);
    this.spinner.stop();

    return {
      scratch: {
        id: scratchOrg.scratchOrgInfo?.Id,
        username: scratchOrg.username,
        durationDays: scratchOrg.scratchOrgInfo?.DurationDays,
        loginUrl: scratchOrg.scratchOrgInfo?.LoginUrl,
      },
    };
  }
}
