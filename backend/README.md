# Backend

## Purpose
Owns server-side logic, APIs, background workers, and data integrations.

## API boundaries
- Expose versioned HTTP APIs consumed by the frontend and external clients.
- Validate and authorize requests at the service boundary.
- Keep transport contracts stable and documented.

## Service boundaries
- **Application layer:** request handling and orchestration.
- **Domain layer:** business rules and core workflows.
- **Infrastructure layer:** persistence, queues, external APIs, and observability.
- Prefer clear module interfaces to keep domain logic independent from infrastructure details.
