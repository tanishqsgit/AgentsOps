# AgentOps — Project Guide

The [platform implementation plan](AgentOps_Implementation_Plan.md) defines provider discovery, native Mastra adoption, Agentic UI choices, and the next layout for each workspace page.

## Product vision

AgentOps lets people create and operate AI-powered companies. People and configurable AI employees belong to teams, receive tasks, collaborate, and produce results that users can inspect. This is a college research and showcase project. Success means real agent work, clear outcomes, and a demo that can be reproduced on another machine.

The primary product is a **self-hostable, headless service**. Operators can set up a company, configure employees and teams, assign tasks, and retrieve results through a documented API and setup commands. Users can talk to agents through configured Mastra channels. The optional web app brings management, chat, workflows, and activity into one place. The Office helps users see who is working in real time.

## Architecture

| Component | Responsibility |
| --- | --- |
| AgentOps service | Standalone TypeScript/Node.js service built on Mastra's server. Owns company operations, authorization, task entry points, execution, and channel handling. Runs in its own Docker container. |
| AgentOps web | Separate Next.js/React app using Tailwind and shadcn/ui. Calls the authenticated service API and consumes permitted read interfaces. Runs in an optional Docker container and can be deployed independently. |
| Authentication and storage | Supabase Auth currently identifies users. The application keeps its own identity directory with stable user IDs. Standard PostgreSQL stores application and Mastra runtime data in separate schemas, including on Mastra-managed Neon. |
| Live activity | The service combines persisted task and conversation states, Mastra delegation hooks, and native workflow snapshots. The web client polls the authenticated snapshot every 2.5 seconds and refreshes on reconnect. |
| Web visualizations | Phaser renders the office. React Flow renders the release brief review graph. Both consume backend data. |

Use one repository and a single service instance initially. Start with Mastra's standard server and add custom routes for organization management and task semantics. Keep orchestration and provider secrets in the service. Share API types with the web client as needed. Use Mastra Studio and traces for operator debugging. [Mastra deployment](https://mastra.ai/docs/deployment/overview) · [Custom API routes](https://mastra.ai/docs/server/custom-api-routes) · [Mastra storage](https://mastra.ai/docs/storage) · [Supabase Realtime](https://supabase.com/docs/guides/realtime/postgres-changes)

## Core behavior

- **Organization.** Start with companies, owner and member permissions, teams, and an optional team lead. Human participants have memberships. AI employees have names, roles, instructions, and allowed tools. Workspace owners can choose the default from Mastra's native model registry. The demo deployment defaults to Mistral's `zai-glm-5-3-flash`. Scope relationships to their company and keep seeded demonstration data identifiable. [Mastra model catalog](https://mastra.ai/models)
- **Tasks.** A user assigns work to an AI employee or a team. A team run uses Mastra's supervisor and subagent support, with eligible agents resolved from saved team membership. Link each task attempt to its Mastra run ID. Preserve the outcome, failure information, and activity needed to understand the run. [Mastra subagents](https://mastra.ai/docs/subagents)
- **Conversations.** Use Mastra Memory for message history. Authorize access to conversations and scope thread and resource IDs to the company and intended audience. Show permitted history in the web app and preserve each conversation's scope across channels. [Mastra Memory](https://mastra.ai/docs/memory/overview)
- **Workflows and approvals.** Use Mastra workflows for repeatable steps whose order or review requirements matter. Start with a configurable template and a native suspend/resume review step. Handle decisions through authenticated backend operations. Evaluate Mastra's beta dynamic workflow definitions before adding visual authoring. [Workflow approval example](https://mastra.ai/learn/build-a-workflow) · [Dynamic workflows](https://mastra.ai/docs/workflows/dynamic-workflows)

## Headless access and channels

Document how to provision or seed a company, configure employees and teams, manage memberships, submit work, and retrieve status and results using setup commands and authenticated HTTP calls. When workflow approvals ship, document their headless path too. The web app uses the same authorization rules and application operations.

**Telegram, Slack, and WhatsApp Business Cloud direct messages and Discord private slash commands** use Mastra's self-managed channel adapters. The owner saves provider credentials and a sender binding in Settings or through the authenticated service API. Each provider sends events to the service's public HTTPS webhook. The adapter handles webhook verification and transport. AgentOps checks the installation and authorized sender before loading company context or invoking an employee. [Mastra Channels](https://mastra.ai/docs/channels)

Use the same company access rules and saved employee configuration for API and channel entry points. Channel chat is the first conversational surface. Explicit task assignment is available through the API and web UI, with channel commands added when useful. Each additional Mastra-supported channel needs its own credentials, routing, and authorization checks before it is listed as supported by AgentOps.

Use the documented Supabase adapter or supported token validation for HTTP authentication, then check membership and resource access in AgentOps. Restrict internal Mastra and Studio routes to operators. Expose only required application routes and enabled provider webhooks. Apply Supabase row-level security to exposed tables and subscriptions. Keep tool permissions narrow and user-facing events free of secrets. Make task submission and side-effecting operations safe to retry. [Mastra Supabase authentication](https://mastra.ai/reference/auth/supabase) · [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Web app and Office

Start with company and roster management, task assignment, run detail, and a conversation view. Reuse these views to surface results and activity across teams.

Settings exposes the workspace model and credential source, native channel connections, and the Mastra Connect provider and tool inventory. Model, channel, and Connect credentials are write-only through the service API. The workspace owner assigns supported tools to employees in People. The Workflows page starts release brief reviews and shows native Mastra run status, current step, and reviewer decisions.

The Office pairs a read-only floorplan with a compact layout of the same workspace conversation surface. Both layouts use the same selected thread, roster, team requests, unsent drafts, and in-flight replies. Switching layouts keeps the workspace conversation mounted. A workspace change or sign-out discards local draft and stream state, and durable messages reload from Mastra Memory. A lightweight directory discovers authorized linked channels. Load message history only for the selected thread. Employee sprites come from the roster and link to the caller's authorized conversation and permitted task details. The floor displays confirmed backend activity and refreshes when the connection returns. [Phaser textures](https://docs.phaser.io/phaser/concepts/textures) · [Mastra Memory](https://mastra.ai/docs/memory/overview)

Use `web/app/theme.css` for shared workspace layout and visual tokens, and `PageHeading` for page titles. The Office fits the available viewport height on desktop and stacks on narrow screens.

Conversations use shadcn Message and Message Scroller, Streamdown for Markdown, and AI SDK v7. Mastra Core 1.85.0 and `@mastra/ai-sdk` 1.12.0 convert live output and stored history to UI message parts. Keep the original JSON chat endpoint for headless clients. [shadcn Chat pattern](https://ui.shadcn.com/docs/ai-elements/base/chat) · [Mastra AI SDK integration](https://mastra.ai/integrations/agentic-ui/ai-sdk-ui)

For future agent browser and sandbox features, provision a provider session scoped to the authorized run. Mastra supports Stagehand and Agent Browser. Browserbase can supply an embeddable live-view URL. A networked Mastra Workspace sandbox can supply an app URL through `sandbox.networking?.getPortUrl(port)`. Publish an AgentOps `data-preview` part from the server using Mastra's tool writer with an ID for updates, and use a screenshot or persisted result for completed sessions. Keep live session URLs out of durable chat history by passing `transient: true` and use a provider-backed authorization check when issuing session access. AgentOps has the renderer and does not provision these providers by default. [Mastra Browser](https://mastra.ai/docs/browser) · [Browserbase live view](https://docs.browserbase.com/platform/browser/observability/session-live-view) · [Mastra sandbox networking](https://mastra.ai/blog/introducing-sandbox-lifecycle-controls)

## Docker and deployment

- Use separate multi-stage Linux images for the service and web client, with pinned base images and a dependency lockfile. Build the production Mastra server into the image and run it as a long-lived process. Keep secrets out of the build context and image layers. [Mastra deployment](https://mastra.ai/docs/deployment/overview)
- Provide Docker Compose for both service-only and service-plus-web operation. Include health checks, documented environment variables, database migrations, and repeatable demo seeding. Keep durable state in PostgreSQL so container replacement preserves saved data. [Compose startup and health checks](https://docs.docker.com/compose/how-tos/startup-order/)
- Use an operator-supplied Supabase project, managed or self-hosted. Document connectivity, model-provider credentials, and HTTPS ingress for channel webhooks. Host the application containers anywhere that supports the published Linux images and can reach these dependencies. Mastra's hosted platform is optional.
- Smoke-test clean builds and startup on Windows Docker Desktop in Linux-container mode and on a Linux host. Validate additional CPU architectures before advertising support. Docker standardizes dependencies, while host architecture, network access, and provider configuration still need verification. [Docker multi-platform builds](https://docs.docker.com/build/building/multi-platform/)

## Implementation milestones

1. **Headless foundation.** Pin compatible Mastra, Node.js, and storage packages. Build the service image and Compose setup. With no web container running, use authenticated API calls to configure a company and employee, run one real task, and fetch the persisted result. Verify rejection of invalid tokens and cross-company requests, deduplication of submissions, and a visible provider error.
2. **Team execution and a native channel.** Verify real supervisor delegation to configured teammates. Confirm that an authorized user can DM the service and receive a reply with the web container stopped. Test rejection of invalid webhook verification and unlinked senders. Verify that saved history survives a restart. Test viewer disconnect separately from runtime termination. Reconcile interrupted runs to a visible, retryable state unless a tested Mastra durability feature recovers them. [Mastra resumable streams](https://mastra.ai/docs/agents/resumable-streams) · [Mastra durable agents](https://mastra.ai/docs/harness/durable-agents)
3. **Optional web showcase.** Add the management client and live Phaser office. Start a task from the headless API and send a message through the channel. Verify that the authorized web client shows their real activity and lets the user inspect results. Confirm reconnect restores the latest state and the service continues running when the web container stops.
4. **Repeatable work and approvals.** Add one Mastra workflow template, one human approval, and a read-only React Flow view. Verify that a pending approval survives restart and the authorized reviewer can act through the API. Expand workflow editing when a tested use case calls for it. [React Flow](https://reactflow.dev/learn)

Keep department hierarchies and horizontal scaling outside the showcase scope. The demo supports web search, native task schedules, team delegation, background assignment, and human review. Additional channels, durable agent recovery, and workflow authoring remain follow-on work.

## Mastra-first development

Before implementing each capability, review official Mastra documentation, examples, integrations, package versions, and current project code. Check native features for execution, delegation, memory, streaming, channels, approvals, observability, and persistent runtime state. Record the chosen API, verified package version, and the smoke test that proves it fits. Verify feature maturity and any separate licensing requirements before adopting optional packages or managed services. [Mastra documentation](https://mastra.ai/docs) · [Mastra Studio](https://mastra.ai/docs/studio/overview)

## First release implementation

- Mastra Core 1.85.0 runs native agents, tools, team delegation, and the release brief review workflow. The approved or rejected outcome lives in the Postgres workflow snapshot. The review accepts a completed structured brief and does not publish anything externally. The first review template uses the public workflow builder and suspend/resume API. Visual workflow authoring would require a separate evaluation of the beta dynamic workflow API.
- Mastra Memory 1.41.2 and Postgres Store 1.37.0 retain website/API conversations and linked channel threads. The pinned Chat SDK adapters at 4.45.0 use the public Mastra AgentChannels API and run with the web container stopped. Each workspace can bind one installation and authorized sender per supported channel.
- `@mastra/connect` 1.4.1 uses Mastra Platform's public-beta service to discover and invoke supported read tools for GitHub, Linear, Notion, and Gmail. Each workspace uses a dedicated Platform project. The employee's saved tool grants control runtime access. Provider write operations require a native approval flow before enabling them in AgentOps. [Mastra Connect tools](https://mastra.ai/reference/connect/tools)
- Authenticated polling is sufficient for the persisted events shown in the showcase and keeps the private application schema out of the browser. The read-only office represents work confirmed by the task, conversation, delegation, and review records. It remains separate from all mutations.
- The supported Compose setup uses one service instance. Interrupted tasks, handoffs, and chats are marked failed on service startup. Suspended workflow runs remain available for an authenticated decision.
- Background assignment uses Core 1.85.0's `createEventedWorkflow()` and `run.startAsync()`. The service accepts the assignment before model generation and the console reads the same task record as headless clients. Generation runs independently of the original HTTP request. This path allows up to five minutes per assignment. It uses the existing task recovery rule after a service restart. [Durable agents and evented execution](https://mastra.ai/docs/harness/durable-agents)
- Schedule actions use the native schedule service. Trigger history comes from the Postgres schedules domain and reports dispatch separately from the actual task outcome. [Schedules](https://mastra.ai/blog/introducing-schedules-for-agents-and-workflows)
- The walkthrough in [README.md](README.md) explains how to seed the demo and run every operation with the web container stopped. Docker builds and smoke checks run on Windows Docker Desktop with Linux containers. A separate Linux host and other CPU architectures need their own smoke check.
