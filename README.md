# AgentOps

AgentOps runs AI employees and teams through a headless Mastra service. The optional web console brings company management, conversations, tasks, release briefs, and the live Office together. Supabase Auth identifies callers, and PostgreSQL stores application records and Mastra runtime state.

## Start with Docker

1. In a Supabase project, create an email/password demo user under Authentication. Set the project URL, `SUPABASE_PUBLISHABLE_KEY`, and PostgreSQL connection string in `.env`, using [.env.example](.env.example) as a reference. If the Docker host lacks IPv6 access, copy the **Session pooler** connection string from the project's Connect dialog. URL-encode any special characters in the database password when constructing the URI. [Supabase connection options](https://supabase.com/docs/guides/database/connecting-to-postgres)
2. Set `MISTRAL_API_KEY`. All employee tasks use Mistral's `zai-glm-5-3-flash` through Mastra's model router. [Mistral model documentation](https://docs.mistral.ai/models/zai-glm-5-3-flash)
3. Build the image, apply the migrations, and start the service.

```sh
docker compose build service
docker compose run --rm --no-deps service node scripts/migrate.mjs
docker compose up -d service
curl http://127.0.0.1:4111/healthz
```

The local Compose port is bound to loopback. Provide ingress for remote clients when deploying. The service has a public readiness endpoint and an authenticated API under `/agentops/v1`.

To add the optional console, run `docker compose --profile web up -d --build web` and open [AgentOps on localhost](http://localhost:3000). Sign in with a confirmed Supabase user. Stop the console independently with `docker compose stop web`. For a separate deployment, build the image in `web/` and supply `AGENTOPS_API_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` at runtime.

For hosted Supabase, keep the `sslmode=verify-full&sslrootcert=certs/supabase-ca.crt` parameters from the example. The image includes the Supabase CA. For self-hosted PostgreSQL, use the CA and settings for that deployment. [Supabase Postgres TLS](https://supabase.com/docs/guides/platform/ssl-enforcement)

For local development with Node.js, run `npm ci`, `npm run migrate`, then `npm run dev` from the project root. The same `.env` and API walkthrough work for both local startup and Docker.

## Seed a demo company

Set `AGENTOPS_TEST_EMAIL` and `AGENTOPS_TEST_PASSWORD` in the current shell for a confirmed user. Run this from the project root against the running service.

```sh
node --env-file=.env scripts/seed.mjs
```

The seed reuses the signed-in user's **AgentOps Demo** company, two named AI employees, release team, and Panel team on subsequent runs. It prints their IDs for the API and Telegram setup and makes no model calls. To run it against a remote instance, set `AGENTOPS_API_URL` to the service origin.

## Run one task from PowerShell

Run these commands with the demo user's Supabase credentials. The sample uses the local Docker endpoint and issues one model request.

```powershell
$supabaseUrl = Read-Host 'Supabase project URL'
$projectKey = Read-Host 'Supabase publishable key'
$email = Read-Host 'Demo user email'
$password = Read-Host 'Demo user password' -MaskInput
$json = 'application/json'
$session = Invoke-RestMethod -Method Post -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
  -Headers @{ apikey = $projectKey } -ContentType $json `
  -Body (@{ email = $email; password = $password } | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($session.access_token)" }
$api = 'http://127.0.0.1:4111/agentops/v1'

$company = Invoke-RestMethod -Method Post -Uri "$api/companies" `
  -Headers $headers -ContentType $json `
  -Body (@{ name = 'Studio North' } | ConvertTo-Json)
$workspace = "$api/companies/$($company.id)"
$employee = Invoke-RestMethod -Method Post -Uri "$workspace/employees" `
  -Headers $headers -ContentType $json `
  -Body (@{
    name = 'Avery'
    role = 'Product analyst'
    instructions = 'Turn product feedback into concise release briefs.'
  } | ConvertTo-Json)

$taskId = [guid]::NewGuid().ToString()
Invoke-RestMethod -Method Post -Uri "$workspace/tasks" `
  -Headers $headers -ContentType $json `
  -Body (@{
    id = $taskId
    employeeId = $employee.id
    outputFormat = 'release_brief'
    prompt = 'Write a release brief. Users requested export to CSV and clearer download errors.'
  } | ConvertTo-Json)
Invoke-RestMethod -Uri "$workspace/tasks/$taskId" -Headers $headers
```

List companies with `GET /companies` and employees with `GET /companies/{companyId}/employees`. Use `PUT /companies/{companyId}/employees/{employeeId}` with the full employee profile to update it.

The task submission waits for the model result. A separate request can retrieve its state while it runs. Omit `outputFormat` or use `text` for free-form output in `result`. With `release_brief`, Mastra uses Mistral's structured output and saves a validated object with `title`, `summary`, and `changes` in `result_data`. [Mastra structured output](https://mastra.ai/docs/agents/structured-output)

The client-supplied task UUID doubles as the Mastra run ID. Sending the same UUID and payload again retrieves the saved attempt. If the service stops mid-run, the single-instance Compose service marks interrupted tasks failed at startup. Use a new UUID for an intentional retry.

## Membership and employee tools

Company owners can list members with `GET /companies/{companyId}/members`, add a confirmed user who has signed in to AgentOps with `POST /companies/{companyId}/members` and `{"email":"member@example.com"}`, and remove a member with `DELETE /companies/{companyId}/members/{memberId}`. Members can read their company roster and tasks, assign work, start reviews, and chat privately with employees. Company settings and review decisions are owner operations.

Employee create and update accept `toolIds: ["feedback-audit"]` to enable a native Mastra tool that counts supplied feedback and detects repeated entries. Send `[]` to clear the tools. Omitting the field when updating preserves the employee's saved tools. [Mastra agent tools](https://mastra.ai/docs/agents/tools)

## Company knowledge

Open **Knowledge → Upload document** as the workspace owner. Upload a UTF-8 TXT, Markdown, CSV, or text-based PDF, up to 2 MiB. The upload is ready to search when the document appears in the list. Use **Test retrieval** to check what the employee can find. In **People**, edit the employee, enable **Search company knowledge**, and save. Ask about a fact in the document and look for the filename and page or excerpt number in the reply.

The owner manages and previews documents. Employees with the tool can use the whole company collection in authorized chats and tasks, including team assignments. People who can talk to a granted employee or view its task results can receive information from that collection. Keep documents that require a narrower audience out of the shared collection.

For headless use, apply the database migrations and set `API` to the service's `/agentops/v1` base URL, `COMPANY_ID` to the workspace ID, and `TOKEN` to the owner's access token. The service accepts a single multipart `file` per request.

```powershell
$url = "$env:API/companies/$env:COMPANY_ID/knowledge"
curl.exe -X POST -H "Authorization: Bearer $env:TOKEN" -F "file=@./policies.pdf" "$url"
curl.exe -H "Authorization: Bearer $env:TOKEN" "$url"
Invoke-RestMethod -Method Post -Uri "$url/search" -Headers @{ Authorization = "Bearer $env:TOKEN" } -ContentType 'application/json' -Body (@{ query = 'travel reimbursement' } | ConvertTo-Json)
curl.exe -X DELETE -H "Authorization: Bearer $env:TOKEN" "$url/$sourceId"
```

Use the ID returned by upload or list for `$sourceId`. Grant `company-knowledge` in the employee's existing `toolIds` array to enable agent access. Search, upload, list, and deletion require owner authorization. Removing a document clears it from future searches. Previous replies, task results, and citations may still refer to it. The workspace can store 100 documents, with up to 200,000 extracted characters per document and 75 pages per PDF. Scanned PDFs require OCR before upload.

## Delegate a task to a team

In the console, **Conversations → Set up Panel** opens the team editor for the owner. Choose a lead and at least one other AI employee. Open the Panel conversation to send background assignments and inspect worker activity. Team tool permissions are configured per employee in People.

Create at least two employees in the company, then `POST /companies/{companyId}/teams` with this body. Use the lead's ID in both fields when assigning a lead. Teams can omit a lead until they're ready to receive work.

```json
{
  "name": "Release team",
  "leadEmployeeId": "<lead UUID>",
  "employeeIds": ["<lead UUID>", "<teammate UUID>"]
}
```

List teams with `GET /companies/{companyId}/teams`. Use `PUT /companies/{companyId}/teams/{teamId}` with the full team payload to change the lead or roster.

To assign a team task, send `teamId` in place of `employeeId` in the task submission. The task's `employee_id` records the lead at submission time. Mastra gives the lead access to the roster's other employees as native subagents. For a structured release brief, the lead uses Mastra's schema prompt option so it can call teammates before returning the validated brief. [Mastra subagents](https://mastra.ai/docs/subagents) · [Structured output with tools](https://mastra.ai/docs/agents/structured-output#combine-tools-and-structured-output)

Use `GET /companies/{companyId}/tasks` for the latest 100 tasks and `GET /companies/{companyId}/tasks/{taskId}/delegations` to see which employees actually received work, their prompts and results, and the status and timing of each handoff. The delegation endpoint can be polled while the submitting request is still running.

## Chat, review, and live activity

All paths below start with `/agentops/v1/companies/{companyId}`.

| Operation | Request |
| --- | --- |
| Send a message | `POST /employees/{employeeId}/chat` with `{"message":"What should we ship?"}` |
| Stream a reply and tool events | `POST /employees/{employeeId}/chat/stream` with the same body. Returns an AI SDK UI message event stream. |
| Read the caller's thread | `GET /employees/{employeeId}/chat` |
| Discover linked channel threads | `GET /channel-threads` returns authorized platform IDs without loading history |
| Read the linked Telegram thread | `GET /telegram` as the linked user |
| Read the linked Slack thread | `GET /slack` as the linked user |
| Read the linked Discord or WhatsApp thread | `GET /discord` or `GET /whatsapp` as the workspace owner |
| Start a review for a successful `release_brief` task | `POST /tasks/{taskId}/review` |
| Read durable review status | `GET /tasks/{taskId}/review` |
| List release brief review runs | `GET /workflows/release-brief-review/runs` |
| Approve or reject | `POST /tasks/{taskId}/review/decision` with `{"approved":true,"note":"Ready to ship"}` or `{"approved":false}` as the company owner |
| Get the live office snapshot | `GET /activity` |

Mastra Memory keeps the most recent conversation turns in context and the API displays up to 50 stored messages. Each person has a private web thread per employee and company. Linked channels use their installation and sender bindings. The service rejects a concurrent reply in the same thread with HTTP 409 and retires an abandoned activity record on the next submission after three minutes.

Chat history includes AI SDK `parts` and retains the plain `text` field. Conversations render Markdown images, image file parts, and image tool results shaped as `{kind: "image", url, alt?}`. An image-producing tool can return a supported image URL or raster data URL. Employee chat uses the configured workspace model. The demo defaults to `zai-glm-5-3-flash`.

For preview cards, a server tool can emit `{type: "data-preview", id, data: {kind: "browser" | "sandbox", title, status: "running" | "completed" | "failed", url?, imageUrl?}, transient: true}` through Mastra's tool writer. Live Browserbase views open in a read-only dialog. Screenshots and sandbox links render in the conversation. See the [provider plan](AgentOps_Project_Guide.md#web-app-and-office) for the session integration.

The review template uses a saved, structured release brief as its input. Mastra suspends the review until the owner decides, then stores the decision with the reviewer ID. The task ID doubles as the workflow run ID. A repeated start or matching decision returns the current state. An approval records a release decision inside AgentOps. [Mastra workflow suspension and resumption](https://mastra.ai/docs/workflows/suspend-and-resume)

The web console polls the authenticated snapshot every 2.5 seconds. The snapshot combines persisted tasks, delegation hooks, conversation activity, and suspended workflow runs. The Office labels a failed refresh as potentially stale and reloads when the connection returns. Choose an employee on the floor or in the conversation panel to view and message that employee. The task shortcut opens the employee's latest tracked task. Polling keeps the activity tables in the private application schema and uses the same company access checks as the headless API.

## Configure a workspace

The owner can use **Settings** in the web app or send authenticated requests to the service. Start the service and apply migrations before saving workspace settings. All paths below start with `/agentops/v1/companies/{companyId}`.

| Operation | Request |
| --- | --- |
| Read configuration and webhook paths | `GET /settings` |
| Browse native model providers and model IDs | `GET /settings/models` and `GET /settings/models?provider={provider}` |
| Verify and save the workspace default model | `PUT /settings/models/default` with `{"modelId":"provider/model","apiKey":"..."}`. Set `apiKey` to `null` to use the provider credentials configured on the server. Send JSON `null` as the request body to restore the deployment default. |
| Link a Mastra Connect project | `PUT /settings/connect` with `{"projectId":"...","accessToken":"..."}`. Send JSON `null` to unlink. |
| Inspect tool availability | `GET /settings/connect/tools` |
| Browse the native Connect inventory | `GET /settings/integrations`. Use `?refresh=true` to refresh discovery from the linked project. |
| List tools that the owner can assign to employees | `GET /tools`. Save tool IDs with the employee's `toolIds` field. |
| Link Telegram | `PUT /settings/channels/telegram` with `{"platform":"telegram","botToken":"...","senderId":"123","employeeId":"..."}` |
| Register the Telegram webhook | `POST /settings/channels/telegram/register` with `{"origin":"https://api.example.com"}` |
| Link Slack | `PUT /settings/channels/slack` with `{"platform":"slack","botToken":"...","signingSecret":"...","senderId":"U123","employeeId":"..."}` |
| Link Discord | `PUT /settings/channels/discord` with `platform`, `botToken`, `signingSecret` (application public key), `senderId`, and `employeeId` |
| Register the Discord command | `POST /settings/channels/discord/register` |
| Link WhatsApp | `PUT /settings/channels/whatsapp` with `platform`, `botToken` (Meta access token), `signingSecret` (Meta app secret), `verifyToken`, `phoneNumberId`, `senderId`, and `employeeId` |
| Remove a workspace binding | `DELETE /settings/channels/{platform}` |

Workspace keys are write-only through the API. Saving a workspace default sends a short test generation through Mastra's native model router. The deployment falls back to Mistral `zai-glm-5-3-flash` and its configured key. Existing clients can still set that fallback's workspace key with `PUT /settings/model`. A selected workspace model also applies to team tasks and channel replies.

Use a Mastra Platform project dedicated to the workspace and authorize the accounts there. **Settings → Integrations** lists the pinned SDK's provider registry and discovers tools from the linked project. Tools marked **Assignable in People** can run in an employee's conversations and tasks. The remaining discovered tools can be inspected while grant and approval support is developed. Connect is optional and currently in public beta. [Mastra Connect](https://mastra.ai/docs/mastra-platform/connect)

Route public HTTPS requests for `/agentops/v1/channel-webhooks/{companyId}/{platform}` to the service. Each workspace binding connects one bot and one authorized direct-message sender to an employee. Send a fresh DM after configuration and inspect the reply or linked transcript. Removing a binding deactivates it in AgentOps. Remove the webhook or event subscription in the provider console if you also want the provider to stop sending events.

- **Telegram.** Create a bot with BotFather and obtain your numeric Telegram user ID. Save the bot and employee under **Settings → Channels**, then register the webhook with the public service origin. [Mastra Telegram setup](https://mastra.ai/integrations/channels/telegram)
- **Slack.** Install a Slack bot app to your workspace with `chat:write` and `im:history`. Save its bot token, signing secret, and your Slack member ID in AgentOps. Copy the webhook URL into Slack **Event Subscriptions → Request URL**, subscribe to `message.im`, and enable the Messages tab in App Home. [Mastra Slack setup](https://mastra.ai/integrations/channels/slack)
- **Discord.** Save the application credentials and your Discord user ID. Set the public AgentOps webhook as the Interactions Endpoint URL in the Discord Developer Portal. Install the bot to a shared server, register the command in Settings, and use `/agentops` with the `prompt` option in a direct message with the bot. [Discord application commands](https://docs.discord.com/developers/docs/interactions/slash-commands)
- **WhatsApp Business Cloud.** Save the Meta access token, app secret, business phone number ID, sender ID, and a verification token you choose. Enter the AgentOps webhook as the callback URL in Meta, enter the same verification token, and subscribe to the `messages` webhook field. [WhatsApp adapter setup](https://chat-sdk.dev/adapters/whatsapp)

`GET /settings` returns `channelCatalog` for the dropdown. The catalog combines the hosted channel registry exposed by `@mastra/connect` with the documented Chat SDK adapter list. Entries marked setup pending need their own installation and delivery flow. The four active channels each allow one installation and one authorized sender per workspace.

## Configure Telegram through Docker environment variables

Operators can also configure a Telegram binding through the service environment. It uses the employee's saved instructions and keeps recent conversation history in Mastra's Postgres-backed memory. This chat works with just the service running. [Mastra Telegram integration](https://mastra.ai/integrations/channels/telegram)

1. Create a dedicated bot with [BotFather](https://t.me/BotFather). Set `TELEGRAM_BOT_TOKEN` and its username without `@` as `TELEGRAM_BOT_USERNAME` in `.env`. Generate a separate random `TELEGRAM_WEBHOOK_SECRET_TOKEN` using letters, digits, underscores, or hyphens.
2. Set `AGENTOPS_TELEGRAM_COMPANY_ID`, `AGENTOPS_TELEGRAM_OWNER_ID` (the company's `owner_id`), and `AGENTOPS_TELEGRAM_EMPLOYEE_ID` from the authenticated AgentOps API. Set `AGENTOPS_TELEGRAM_SENDER_ID` to your numeric Telegram user ID. Before installing a webhook, you can send the bot a DM and inspect `message.from.id` in its Bot API `getUpdates` response.
3. Run `docker compose up -d --build service` and copy the webhook path printed by `docker compose logs service`. Route HTTPS requests for that path to the service. Keep the bot token and webhook secret in server configuration.
4. Register the public URL with Telegram. From the project root in PowerShell, run the following and enter the full public webhook URL when prompted. [Telegram setWebhook](https://core.telegram.org/bots/api#setwebhook)

```powershell
$env:AGENTOPS_TELEGRAM_WEBHOOK_URL = Read-Host 'Public HTTPS webhook URL'
@'
const response = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/setWebhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    url: process.env.AGENTOPS_TELEGRAM_WEBHOOK_URL,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
    allowed_updates: ['message'],
  }),
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(result.description ?? 'Webhook registration failed.');
console.log('Telegram webhook registered.');
'@ | node --env-file=.env --input-type=module
```

Send the bot a new direct message from the linked Telegram account. Group messages and unlinked senders are ignored. If you change the binding, restart the service and register the new webhook URL. The new binding starts a separate conversation. Leave `TELEGRAM_BOT_TOKEN` blank for API-only operation.

## Deploy the headless service on Mastra Platform

Use a staging environment in the existing Platform project. Attach managed Neon PostgreSQL for a target that supports direct migration from a workstation. The platform injects `DATABASE_URL`; the application and runtime use the `agentops` and `mastra` schemas on that database. Keep `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for the current login provider and set `MISTRAL_API_KEY` on the environment. Host the optional Next.js console separately with `AGENTOPS_API_URL` pointing at the deployed server. [Managed databases](https://mastra.ai/blog/introducing-managed-databases) · [Platform deploy](https://mastra.ai/docs/mastra-platform/deploy/overview)

For an empty staging database, set `DATABASE_URL` to its connection string in the current terminal and run `npm run migrate` before the first deploy. For an existing workspace migration, back up the source, apply the identity migrations to a copy, then transfer the `agentops` and `mastra` schemas together into an empty target. The application identity table preserves current user IDs. Use a controlled cutover so enabled schedules and channel bots do not serve from both environments.

For managed Neon, retrieve the migration connection string with `npx mastra env db show <database-id> --show-secrets`. Pulling environment variables lists the managed variable names only. Use the environment name `staging` for `mastra deploy --env`.

Deploy from the repository root using an explicit empty environment file so the local `.env` is not bundled. Configure runtime values in the Platform dashboard first.

```powershell
New-Item -ItemType File -Path .env.mastra-deploy
npx mastra deploy --project <project-id> --env staging --env-file .env.mastra-deploy
```

Check `/healthz`, a signed-in workspace request, and an agent conversation against the staging server before moving the console or any provider webhooks. Platform Studio sign-in authenticates operators. The AgentOps API uses its own user authentication. [Studio and server authentication](https://mastra.ai/docs/mastra-platform/deploy/studio#authentication)

For the linked AgentOps project, run `./scripts/deploy-staging.ps1` in PowerShell to reuse the current Supabase Auth and Mistral settings from the local `.env`. The script stages those three settings in an ignored file, removes it after the deploy, and leaves database and observability credentials to Platform.

To use the Docker console with a hosted service, set `AGENTOPS_WEB_API_URL` to its API origin in the terminal or the local Compose `.env`, then run `docker compose --profile web up -d --no-deps web`. Omit the setting to use the local service.

Platform observability uses the project ID and access token injected into the hosted service. After deploying, send an employee chat message and look for an `agentops` trace in the project's **Traces** page. For Docker or another host, set `MASTRA_PROJECT_ID` and `MASTRA_PLATFORM_ACCESS_TOKEN` on the service to opt in. The exporter filters known credential fields from spans. [Platform observability](https://mastra.ai/docs/mastra-platform/observability/overview)

### GitHub deployment

Link the existing project from **Project settings → Repository → Link repository**. Give the official GitHub App access to `vhp90/AgentsOps` and select `main` for the deploy targets you use. The repository's `.mastra-project.json` identifies the existing project. Keep provider credentials in the platform environment. Apply new application SQL migrations to each target before pushing changes that depend on them. GitHub pushes build the headless service and optional operator Studio. Deploy the Next.js console separately. Check the GitHub commit SHA in the deployment detail and verify `/healthz` after the first automatic deploy. [GitHub integration](https://mastra.ai/docs/mastra-platform/deploy/github)

Staging uses serverless compute. A one-time schedule has been verified to run an employee task while the service is awake. **Workflows → Schedules → History** shows dispatch and, once a task exists, its status and a link to its result. The headless history endpoint returns the same linked task ID and status. Before relying on unattended schedules or long-running work, verify execution across idle periods and redeploys on the intended hosting configuration. [Server idle behavior](https://mastra.ai/docs/mastra-platform/deploy/server#idle-behavior) · [Deployment behavior](https://mastra.ai/docs/mastra-platform/deploy/overview)

## Deploy the web console on Render

Create a **Web Service** from `vhp90/AgentsOps`. The console runs the Next.js server from `web/Dockerfile` and forwards authenticated API requests, streaming conversations, and knowledge uploads to AgentOps. [Render Docker](https://render.com/docs/docker)

| Render setting | Value |
| --- | --- |
| Branch | `main` |
| Runtime | Docker |
| Root Directory | `web` |
| Dockerfile Path | `./Dockerfile` |
| Docker Build Context | `.` |
| Health Check Path | `/healthz` |
| Auto-Deploy | On Commit |

Render resolves the Dockerfile and build context relative to the root directory. Git pushes affecting `web/` trigger a frontend deploy. Choose a region close to the API. Render's Starter instance keeps the console running. The Free instance spins down after 15 minutes without traffic. [Monorepo settings](https://render.com/docs/monorepo-support) · [Render plans](https://render.com/hosting/nextjs)

Set these environment variables in the web service before deploying.

| Variable | Value |
| --- | --- |
| `AGENTOPS_API_URL` | HTTPS origin of the deployed AgentOps API, with no path |
| `SUPABASE_URL` | Auth project URL used by the API |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key for that same Auth project |

The console health check verifies that these variables are set. Check the API's `/healthz` separately, then open the frontend and sign in. Provider keys and the database connection belong on the backend.

## Web search, Python sandbox, and schedules

In **Settings → Integrations**, save a Tavily, Brave Search, or TinyFish API key. Grant **Web search** to the intended employee in **People**. The tool returns public web results with source links. With TinyFish selected, grant **Fetch web page** separately to let an employee read public pages. Owners can also manage the workspace provider with `PUT /agentops/v1/companies/{companyId}/settings/search` and a body containing `provider` (`tavily`, `brave`, or `tinyfish`) and `apiKey`. Send JSON `null` to disconnect.

Apply `db/013-modal-sandbox.sql` before deploying the Modal runtime. Save a [Modal token pair](https://modal.com/settings/tokens) in **Settings → Integrations → Python sandbox**, or send `{ "tokenId": "ak-…", "tokenSecret": "as-…" }` to `PUT /agentops/v1/companies/{companyId}/settings/sandbox` as the workspace owner. JSON `null` disconnects it. Grant **Python sandbox** in **People**. Existing grants work once Modal is configured. Each call starts a fresh sandbox with outbound networking blocked, runs Python with a 20-second command timeout, and returns bounded stdout, stderr, and the exit code. The service requests termination after each call and sets a 60-second sandbox lifetime.

To run a live smoke test of the same tool without the web app, load `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` into your local process and run `npm run test:modal`. It checks Python output, process exit, and outbound network blocking. The runtime uses the Modal SDK inside a Mastra tool because `@mastra/modal` 0.7.4 does not expose Modal's creation-time network block. [Mastra Modal integration](https://mastra.ai/integrations/sandboxes/modal) · [Modal Sandbox SDK](https://modal.com/docs/sdk/js/latest/Sandbox)

In **Workflows → Schedules**, choose an employee or a team with a lead, enter the task, then select a local date or a recurring cron expression with its time zone. Runs appear under Tasks, and scheduled release briefs go to human review. The service container runs the scheduler independently of the web app.

Headless scheduling uses `GET /schedules`, `POST /schedules`, and `DELETE /schedules/{scheduleId}` under the company API prefix. Create requests take a `name`, the same `task` object used for ordinary assignment, and either an ISO `runAt` or a `cron` with optional IANA `timezone`.

Use `POST /schedules/{scheduleId}/action` with `{"action":"pause"}`, `{"action":"resume"}`, or `{"action":"run"}`. Run-now applies to active recurring schedules. Use `GET /schedules/{scheduleId}/history` for the 15 latest trigger records. Check Tasks for the result of an individual execution.

The Tasks page uses `POST /tasks/background` with the standard assignment body and ID. The service returns HTTP 202 with the queued task. Poll `GET /tasks/{taskId}` for the final result. Resubmitting the same ID and payload returns the existing task. Background tasks may run for up to five minutes. The original `POST /tasks` waits for completion.
