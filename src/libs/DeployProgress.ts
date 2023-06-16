import { env } from '@salesforce/kit';
import {
  type DeployResult,
  type MetadataApiDeploy,
  type MetadataApiDeployStatus,
} from '@salesforce/source-deploy-retrieve';
import { Progress } from '@salesforce/sf-plugins-core';

export class DeployProgress extends Progress {
  private static OPTIONS = {
    title: 'Status',
    format: '%s: {status} | {bar} | {value}/{total} Components',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    linewrap: true,
  };

  public constructor(private deploy: MetadataApiDeploy, jsonEnabled = false) {
    super(!jsonEnabled && env.getBoolean('SF_USE_PROGRESS_BAR', true));
  }

  public start(): void {
    this.deploy.onUpdate((data: MetadataApiDeployStatus) => {
      const numberComponentsTotal: number = data.numberComponentsTotal;
      const numberTestsTotal: number = data.numberTestsTotal;
      const numberComponentsDeployed: number = data.numberComponentsDeployed;
      const numberTestsCompleted: number = data.numberTestsCompleted;
      const status: string = data.status ?? 'Waiting';

      if (numberComponentsTotal) {
        this.setTotal(numberComponentsTotal + numberTestsTotal);
        this.update(numberComponentsDeployed + numberTestsCompleted, { status });
      } else {
        super.start(0, { status }, DeployProgress.OPTIONS);
      }

      if (numberTestsTotal && numberComponentsTotal) {
        this.setTotal(numberComponentsTotal + numberTestsTotal);
      }
    });

    this.deploy.onFinish((data: DeployResult) => this.finish({ status: data.response.status }));

    this.deploy.onCancel(() => this.stop());

    this.deploy.onError((error: Error) => {
      this.stop();
      throw error;
    });
  }
}
