export default {
  // Optional shared secret for the health endpoints (`/health/live`,
  // `/health/ready`). Unset (the default) leaves them open. When set, probes
  // send it in the `X-Health-Token` header (preferred) or as `?token=` for load
  // balancers that cannot send headers (e.g. AWS ALB health checks).
  token: process.env.HEALTH_TOKEN as string | undefined,
};
