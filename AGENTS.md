# AgentOps — AI Coding Agent Context

Read [AgentOps_Project_Guide.md](AgentOps_Project_Guide.md) before implementing changes. It defines the product scope, architecture, and milestone acceptance checks.

Read the [platform implementation plan](AgentOps_Implementation_Plan.md) for the native Mastra adoption decisions and page designs. Keep demo providers and workflow templates configurable as the platform develops.

## Product direction

AgentOps is a college research and showcase project for operating AI-powered companies. Users organize people and AI employees into teams, assign work, converse with agents, and inspect real outcomes. Prioritize a few complete, reliable experiences.

**Build the headless service first.** The standalone Mastra service owns execution, policies, and the application API. An operator must be able to configure and operate AgentOps through documented API calls or scripts and converse through a configured Mastra channel with the web app absent. The separate Next.js app is an optional management and presentation client. The Phaser office is an optional, read-only visualization within that client.

## Mastra first, every time

Before implementing a feature, check the current official Mastra docs, examples, integrations, pinned SDK, and existing project code. Check agents, stored configuration, tools, subagents, workflows, approvals, memory, streaming, observability, storage, channels, and deployment wherever relevant. Reuse suitable Mastra capabilities. If they fall short, choose the smallest supported alternative and record the gap. Confirm the API works with the installed version and record any beta or licensing dependency that affects the design.

Use Mastra as the sole agent framework. Use its standalone Node.js server and native channels where they fit. Keep AgentOps code focused on organization data, tenant authorization, assigning work, and presenting results.

## Engineering boundaries

- Keep the service and web app independently buildable and runnable in one TypeScript repository. The web app uses the service's authenticated API and read interfaces. Keep model, database service, and channel credentials in backend configuration.
- Treat Docker as the supported path for development, smoke testing, and deployment. Docker Compose must support service-only operation and an optional web service. Pin dependencies and runtime images, document configuration and migrations, and verify the hosts and architectures we claim to support.
- Use Supabase Auth and PostgreSQL. AgentOps owns company, membership, team, employee, assignment, and user-facing activity records. Mastra owns runtime state and conversation memory. Reuse one Postgres deployment with appropriate schema and access boundaries.
- Enforce company membership and permissions on the server for every entry point. Verify channel signatures or secrets through the adapter and authorize the linked sender before loading company context or invoking agents. Keep internal Mastra routes and Studio restricted to operators.
- Keep companies, teams, employees, assignments, and workflow choices data-driven. Scope delegation and tools to the authorized company and team, bound execution, and use native Mastra approvals for consequential actions.
- Derive dashboard and office activity from confirmed backend events. Keep the office usable with reconnects and missing data, and keep all operations available when the office or entire GUI is absent.
- Use the shared web theme and page heading for workspace pages. Reuse shadcn conversation primitives and keep rich chat content in AI SDK message parts so each integration can reuse the same renderer.
