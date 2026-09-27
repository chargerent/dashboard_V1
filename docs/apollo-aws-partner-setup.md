# Chargerent Apollo AWS setup recipe

## Message to the AWS partner

Please prepare the AWS foundation for Chargerent's new Apollo/Payter transaction platform. The first deployment is an isolated lab connected only to a dedicated test kiosk. After that passes physical payment and dispense testing, we will deploy a separate production environment for French kiosks.

This is not a request to copy the current Canadian Node-RED server or create a public Mosquitto port. The new platform will use managed AWS services and will be deployed from infrastructure-as-code. The kiosk can continue to use an isolated edge Node-RED adapter for local hardware and vend control, but central payment/session state will run in AWS.

### Target structure

- AWS Organization, if Chargerent does not already have one.
- Non-production AWS account: `chargerent-apollo-lab`.
- Production AWS account: `chargerent-apollo-prod-fr`.
- Preferred application Region: `eu-west-3` (Paris).
- Separate identity, secrets, certificates, data, callbacks, logs, alarms, and billing controls in each account.
- No dependency from production to the lab account.
- Do not deploy the workload into the AWS Organizations management account.

AWS recommends separating production and non-production workloads into different accounts because an account is a security, billing, and quota boundary. Europe (Paris), `eu-west-3`, supports the principal services planned for this platform, including AWS IoT Core and Step Functions.

## What to set up before the engineering session

### 1. Create the two workload accounts

Create the lab account now. The production account may also be created now, but no terminal or Payter credential should be activated there until the lab acceptance tests pass.

Use business-controlled group email addresses for the account root contacts, not an employee's personal address. Add current security, billing, and operations alternate contacts. Protect root with phishing-resistant MFA where available and do not create root access keys.

Record and return:

- AWS Organization ID.
- Lab AWS account ID.
- Production AWS account ID.
- Confirmed Region.
- The names of the people/groups responsible for security, billing, and operational alerts.

### 2. Configure federated access

Enable AWS IAM Identity Center and require MFA. Create these groups or equivalent permission sets:

- `ApolloPlatformAdmins`: a very small break-glass/platform group.
- `ApolloDeployers`: engineers allowed to assume the deployment role.
- `ApolloReadOnly`: support and audit access without mutation rights.

For the initial lab bootstrap, give the named Chargerent engineer temporary federated access capable of creating CloudFormation/CDK resources and IAM service roles in the lab account. After bootstrap, replace this with a dedicated `ApolloDeploymentRole` and least-privilege CloudFormation execution role. Production deployment access must be separate and approval-gated.

Do not send an AWS root password, IAM user password, permanent access key, secret access key, or copied browser session. Send the AWS Identity Center start URL and assign the user/group instead.

The deployment role will ultimately need scoped access to:

- CloudFormation and the CDK bootstrap resources.
- IAM role and policy creation for this workload, with a permission boundary.
- Lambda, API Gateway, AWS IoT Core, SQS, Step Functions, DynamoDB, EventBridge, CloudWatch and CloudWatch Logs.
- Secrets Manager, KMS, S3 and ECR used by the deployment.
- ACM and Route 53 only if DNS is managed in this account.

### 3. Establish security and audit controls

At the Organization or account level:

- Enable a multi-Region CloudTrail trail, including global service events and log-file validation.
- Deliver the trail to an encrypted, access-logged S3 audit bucket with retention protected from ordinary workload roles.
- Enable GuardDuty and Security Hub for both accounts, or confirm the organization's existing delegated security setup covers them.
- Enable IAM Access Analyzer.
- Block public access for S3 at the account level unless a documented exception is approved.
- Keep production logs and secrets inaccessible to the lab deployment role.

### 4. Configure cost controls

Create separate monthly AWS Budgets for lab and production with both actual-spend and forecast-spend notifications. Send alerts to a monitored group mailbox and, if available, an SNS operations topic. Apply these tags to deployable resources:

- `Application=apollo-platform`
- `Environment=lab` or `Environment=prod-fr`
- `Owner=chargerent`
- `ManagedBy=iac`
- `DataClass=operational`

Please tell engineering the approved monthly lab and production budget amounts. Do not guess the thresholds.

### 5. Prepare DNS, but do not point Payter to it yet

Choose or delegate two distinct API hostnames, for example:

- `apollo-lab-api.<company-domain>`
- `apollo-fr-api.<company-domain>`

Tell engineering which Route 53 hosted zone or external DNS provider owns the names. If DNS is external, arrange for someone to add the ACM validation and API alias/CNAME records during the deployment session. A Regional API Gateway custom domain requires an ACM certificate in the same Region as the API.

Do not change the current Canadian callback records. Do not configure a Payter webhook yet. The new environments will have separate hostnames while retaining the expected callback paths:

- `POST /api/ui`
- `POST /api/apollo_states`

### 6. Leave the application resources for infrastructure-as-code

Please do not manually create an EC2 Node-RED server, a Mosquitto broker, public inbound MQTT rules, Lambda functions, DynamoDB tables, or API Gateway routes. Engineering will deploy and version these as one reproducible stack:

- API Gateway for the Payter callback surface.
- Lambda validation and integration handlers.
- SQS FIFO with a terminal serial number as the message group, plus dead-letter queues.
- Step Functions Standard for the payment/rental/dispense state machine.
- DynamoDB for terminal registry, transaction/session state, idempotency, profile releases, and assignments, with point-in-time recovery in production.
- AWS IoT Core for kiosk MQTT over mutual TLS on standard port `8883` or TLS/WebSocket `443`.
- One AWS IoT Thing and individual X.509 certificate per kiosk, with a policy limited to that kiosk's command, event, acknowledgement, and status topics.
- Secrets Manager for Payter CPS credentials and dashboard-to-runtime integration secrets.
- CloudWatch dashboards, structured logs, metrics, alarms, and log-retention policies.
- WAF/rate limiting where compatible with Payter's callback behavior.

There is no custom public MQTT port to open. Isolation comes from separate AWS accounts, device certificates, IoT policies, and topic namespaces—not a second unauthenticated broker port.

### 7. Bootstrap requirements

Install nothing on a server. Before the engineering session, confirm only that:

- The AWS CLI/Identity Center assignment can sign into the lab account.
- The selected engineer can assume the temporary lab bootstrap permission set.
- CloudFormation can create workload roles under the agreed permission boundary.
- The account has no Service Control Policy blocking the services listed above.
- The `eu-west-3` quotas are adequate for an initial one-terminal lab.
- The DNS owner is available to approve certificate validation if required.

Engineering will run the CDK bootstrap and application deployment. Please do not email or paste any secret into a ticket or chat.

## What to send back

Send a non-secret handoff containing:

- Organization ID and the two AWS account IDs.
- Identity Center start URL and the names of the assigned permission sets/groups.
- Selected Region.
- DNS zone/domain owner and proposed lab/production API hostnames.
- Alert recipient group(s).
- Approved budget figures.
- Confirmation of CloudTrail, GuardDuty, Security Hub, Access Analyzer, and account-level S3 public-access blocking.
- Any applicable Service Control Policies or permission boundaries.
- The person authorized to approve the eventual production deployment.

Do not include passwords, access keys, private keys, Payter API keys, kiosk certificates, or certificate private keys in the handoff.

## What Chargerent must provide to engineering

### AWS and DNS

- Federated lab access and, later, separately approved production access.
- The exact AWS account IDs, Region, domain names, hosted-zone ownership, alert recipients, retention requirements, and budget limits.
- A decision on repository and CI/CD ownership. The recommended default is a protected deployment pipeline that assumes `ApolloDeploymentRole`; engineers should not deploy production from long-lived local credentials.

### Payter

- The dedicated test terminal serial number as shown in MyPayter.
- Confirmation of which CPS environment currently recognizes that serial: test/dev or production.
- The CPS base URL and credential scope for the lab terminal.
- A separate production credential or written confirmation from Payter of the safe credential/webhook isolation model.
- Confirmation that changing a global Payter webhook will not redirect callbacks for existing Canadian terminals.
- Secure entry of the CPS API key directly into the appropriate AWS Secrets Manager secret. Do not send the value to engineering in chat.

Do not generate a replacement Payter API key casually: Payter's production key-generation endpoint warns that creating a new key invalidates the current key.

### Dedicated test kiosk and vend contract

- Test kiosk station ID, current provision ID, client ID, and confirmation that `hardware.gateway` is exactly `APOLLO`.
- Kiosk hostname/device identity and network egress capability to AWS IoT Core on TLS `8883` or `443`.
- Module IDs, slot map, charger inventory rules, and the exact command/acknowledgement MQTT contract used for availability, dispense, return, and failure.
- A redacted export of the relevant current Node-RED transaction logic and representative redacted message samples.
- An onsite operator who can see the terminal, use a real test card/payment method, confirm the physical slot outcome, recover a charger, and stop the test if needed.

### Client profile and business rules

- The initial client ID and which saved Apollo profile will be its starting point. The expected baseline is the 13-screen `yyz-apollo-v1` profile.
- English and French copy, currency, price, tax treatment, authorization/commit rules, session timeouts, cancellation behavior, return behavior, offline behavior, sold-out behavior, and support contact text.
- Confirmation that Availability and Dispensing remain required runtime states. Optional presentation screens may be skipped, but the underlying business events may not be deleted.
- The policy for publishing a profile release, approving it, rolling it back, and assigning it to every Apollo kiosk for that client.

### Operations and compliance

- Named operational and security contacts and the desired alert channel.
- Log and transaction-record retention periods.
- Incident severity definitions and support coverage hours.
- Reconciliation source of truth and the person responsible for payment/refund review.
- Confirmation that no full card number, sensitive authentication data, CPS key, or certificate private key may be stored in application logs or DynamoDB.

## Engineering production-readiness work

Once the foundation and inputs above are available, engineering must still complete the following. An AWS account by itself is not a production system.

1. Define the Payter, kiosk MQTT, Firebase/dashboard, profile-release, and rental-record contracts as versioned schemas.
2. Implement the central TypeScript runtime and state machine with validation, idempotency, per-terminal locking, timeouts, retries, dead-letter handling, and reconciliation.
3. Create the Firebase-to-AWS profile publisher so a client draft becomes an immutable release; active sessions stay pinned to their starting profile version and a client assignment can be rolled back.
4. Build the isolated kiosk Node-RED/AWS IoT adapter for local availability, vend, return, and acknowledgements. It must not share the Canadian broker, callback host, credentials, global state, or logs.
5. Add structured audit events that link terminal serial, kiosk, client, profile version, Payter session, rental, vend command, and vend acknowledgement without logging payment secrets.
6. Add dashboards and alarms for callback failures, stale kiosks, queue age, dead-letter messages, duplicate callbacks, stuck sessions, Payter errors, authorization-without-vend, and vend-without-rental.
7. Add automated unit, contract, integration, security, and infrastructure tests plus a repeatable deployment and rollback procedure.
8. Run a lab acceptance plan on the physical test kiosk.
9. Perform an independent production security/configuration review, restrict deployment permissions, back up the profile and state data, and rehearse recovery.
10. Create the French production account stack from the same code, enter separate production secrets, register only approved terminals, and perform a one-terminal canary before adding a client fleet.

## Physical lab acceptance gates

The lab is not accepted based only on an HTTP 200 response, a successful AWS deployment, a dashboard acknowledgement, or a Payter API response. Capture evidence for all of these cases:

- Terminal boots and reaches the correct client profile version.
- English and French screens render correctly on the physical device.
- Availability is accurate before payment.
- Approved payment, declined payment, user cancellation, and timeout.
- Successful dispense with matching physical slot/charger evidence.
- Vend failure after authorization and the correct cancel/refund/reconciliation result.
- Duplicate and delayed Payter callbacks do not create duplicate charges, vends, or rentals.
- MQTT disconnect/reconnect, kiosk reboot, backend retry, and Payter timeout recover safely.
- Return flow and charger reconciliation.
- Profile publication, rollback, and a new session using the new version while an active session remains pinned to its original version.
- Alarms fire and the runbook identifies the correct terminal/session without exposing payment secrets.

Only after these tests pass should the production Payter credentials and French terminal allowlist be enabled.

## Reference basis

- AWS Organizations recommends separate production and non-production workload accounts: <https://docs.aws.amazon.com/organizations/latest/userguide/orgs_best-practices.html>
- AWS IAM recommends federated human access with temporary credentials: <https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html>
- AWS IoT Core supports mutual-TLS MQTT with X.509 certificates on `8883` or `443`: <https://docs.aws.amazon.com/iot/latest/developerguide/iot-authorization.html>
- AWS IoT Core and Step Functions are available in Europe (Paris): <https://docs.aws.amazon.com/general/latest/gr/iot-core.html> and <https://docs.aws.amazon.com/general/latest/gr/step-functions.html>
- Step Functions Standard is intended for durable, auditable, exactly-once workflow execution such as payment processing: <https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html>
- SQS FIFO message groups preserve ordering within each terminal stream, while Lambda consumers must still be idempotent: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/using-messagegroupid-property.html> and <https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html>
- Secrets Manager guidance: <https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html>
- Regional API Gateway custom domains require an ACM certificate in the same Region: <https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-regional-api-custom-domain-create.html>
- AWS Budgets supports actual and forecasted spend alerts: <https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html>
