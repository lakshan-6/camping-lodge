# Private external backups

The application is ready to upload encrypted backups to a private S3-compatible bucket. No storage account has been connected or created for this project. Until you complete setup, download encrypted backups and keep copies outside the database.

## Free-allowance option: Cloudflare R2 Standard

R2 Standard currently includes 10 GB-month storage, one million Class A and ten million Class B operations each month. Usage beyond allowances is billed, so this is not an unlimited free service. Review the account's pricing and any billing requirements yourself before enabling it. Do not choose Infrequent Access, which does not receive this free allowance. [Official pricing](https://developers.cloudflare.com/r2/pricing/).

1. Sign in to your Cloudflare account and open R2 Object Storage. Complete account/billing setup yourself if requested; do not share payment details or credentials in chat.
2. Create a dedicated **private Standard bucket**, for example `camping-lodge-private-backups`. Leave public access, `r2.dev` access and public custom domains disabled. See [bucket creation](https://developers.cloudflare.com/r2/buckets/create-buckets/).
3. Add an object lifecycle rule for the `camping-lodge/` prefix to expire old backups after 30 days. This project does not delete remote backups itself. Keep important downloaded recovery copies separately. See [object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
4. Create an R2 API credential with **Object Read & Write**, limited to this bucket. Record its Access Key ID and Secret Access Key privately. Do not use a global account API key. [Official token instructions](https://developers.cloudflare.com/r2/api/tokens/).
5. In the existing Render service's private Environment settings, add these values:

   | Setting | Value |
   | --- | --- |
   | `BACKUP_S3_ENDPOINT` | The HTTPS S3 API endpoint shown by R2, such as `https://ACCOUNT_ID.r2.cloudflarestorage.com` (no bucket/path). Use the endpoint for your bucket's jurisdiction. |
   | `BACKUP_S3_BUCKET` | Your private bucket name |
   | `BACKUP_S3_REGION` | `auto` |
   | `BACKUP_S3_PREFIX` | `camping-lodge` |
   | `BACKUP_S3_ACCESS_KEY_ID` | The private Access Key ID |
   | `BACKUP_S3_SECRET_ACCESS_KEY` | The private Secret Access Key |

6. Keep the **existing** `BACKUP_ENCRYPTION_KEY`. Do not replace it: it decrypts existing backups and the owner's authenticator secret. Keep a recovery copy outside both Render and this bucket.
7. Save and redeploy. Open **Backups**, confirm the bucket is connected, then create a backup. Its External copy column must say **Uploaded and read-back verified**. A failed upload keeps the local copy and displays the failure; it is not a verified off-site backup.
8. Download the external object from R2 privately. In the app, choose that file and **Check file without restoring**. This validates decryption, collection schemas, recovery credentials and required record links without changing live data.

Daily automatic uploads happen while the Render service is awake. Sleeping services miss scheduled work; checks resume when awake. Failed automatic uploads retry on later hourly checks. Manual backups also upload when the bucket is configured. Monitor free allowances and bucket retention in your storage dashboard. The app does not enforce a provider billing cap.

## Recovery practice

For a full recovery drill, use a separate disposable Atlas database and a separate local/test instance. Supply the original encryption key privately, create a temporary owner, configure a temporary owner delete key, validate the downloaded external file and restore it **only in that test instance**. Check orders, money, stock, account login and 2FA there. Never use the live database for a practice restore. Restoring reintroduces the backup's accounts, passwords, MFA settings and unused-at-backup recovery codes; regenerate recovery codes after a real restore.

The automated integration tests already exercise transaction rollback, actual restore and session invalidation in temporary MongoDB replica sets. External transport tests use a simulated private storage service, including successful read-back, corrupted responses, access rejection and connection failure. A real provider round trip cannot be verified until you connect a bucket.

## Other S3-compatible services

Use the service's HTTPS S3 origin, bucket, signing region and long-lived scoped access keys. The implementation uses S3 Signature V4 and path-style bucket addressing. Temporary session-token credentials and custom endpoint path prefixes are not supported. Provider pricing differs; selecting another service does not guarantee a free plan.
