import { Stack, StackProps, aws_certificatemanager as acm, aws_route53 as route53, aws_ssm as ssm } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Common } from "./common";

export interface CertStackProps extends StackProps {
  domainName: string;
}

export class CertStack extends Stack {
  constructor(scope: Construct, id: string, props: CertStackProps) {
    super(scope, id, props);

    const { domainName } = props;
    const common = new Common();

    // Create certificate for CloudFront
    const certificate = new acm.DnsValidatedCertificate(this, "Certificate", {
      certificateName: common.getResourceName("certificate"),
      domainName: domainName,
      subjectAlternativeNames: [`*.${domainName}`],
      region: "us-east-1",
      validation: acm.CertificateValidation.fromDns(),
      cleanupRoute53Records: false, // for safety
      hostedZone: route53.HostedZone.fromLookup(this, "HostedZone", {
        domainName: common.getHostedZone(),
      }),
    });

    // Put certificate ARN to SSM parameter store
    new ssm.StringParameter(this, "CertificateParameter", {
      parameterName: common.getResourceNamePath("certificate"),
      stringValue: certificate.certificateArn,
    });
  }
}
