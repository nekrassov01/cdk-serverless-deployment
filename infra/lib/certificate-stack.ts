import {
  App,
  Stack,
  StackProps,
  aws_certificatemanager as acm,
  aws_route53 as route53,
  aws_ssm as ssm,
} from "aws-cdk-lib";
import { Construct } from "constructs";

const app = new App();

const serviceName = app.node.tryGetContext("serviceName");
const environmentName = app.node.tryGetContext("environmentName");
const branch = app.node.tryGetContext("branch");
const hostedZoneName = app.node.tryGetContext("domain");
const domainName = `${serviceName}.${hostedZoneName}`;

export class CertificateStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Get hosted zone domain name
    const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: hostedZoneName,
    });

    // Create certificate for CloudFront
    const certificate = new acm.DnsValidatedCertificate(this, "Certificate", {
      certificateName: `${serviceName}-certificate`,
      domainName: domainName,
      subjectAlternativeNames: [`*.${domainName}`],
      region: "us-east-1",
      validation: acm.CertificateValidation.fromDns(),
      cleanupRoute53Records: false, // for safety
      hostedZone: hostedZone,
    });

    // Put certificate ARN to SSM parameter store
    new ssm.StringParameter(this, "GlobalCertificateParameter", {
      parameterName: `/${serviceName}/${environmentName}/${branch}/certificate`,
      stringValue: certificate.certificateArn,
    });
  }
}
