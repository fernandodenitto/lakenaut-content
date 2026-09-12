---
id: cluster-policies
title: "Cluster policies"
area: compute
level: intermediate
summary: A cluster policy is an admin-defined JSON rule set that locks down what a user can configure on a cluster, enforcing cost, security, and tagging limits.
prerequisites: [compute-options, jobs-overview]
related: [instance-pools, runtime-and-photon, cluster-troubleshooting, bundles-overview]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/admin/clusters/policies
    checked: 2026-09-10
  - url: https://docs.databricks.com/aws/en/admin/clusters/policy-definition
    checked: 2026-09-10
aliases: [compute policy, policy family, policy JSON, fixed allowlist range forbidden]
updated: 2026-09-10
status: published
---

## What it is

A cluster policy is a JSON document, attached in the admin console, restricting what a user or group can put into a cluster configuration: instance types, whether autoscaling is mandatory, the max DBU-per-hour spend, which tags must be present. Instead of "Unrestricted" with every field open, a user picks a policy from a dropdown and the locked fields disappear or get pre-filled.

## Why it exists

Give everyone "Unrestricted" and you get clusters sized for a demo running in production, GPUs nobody needed, tags nobody set — the cloud bill and the security review both become unreadable. A policy turns "please don't do that" into something the UI enforces before the cluster starts, per team: data science gets big single-node machines, a job's service principal gets one shape of cluster and nothing else.

## How it works

### Policy families

Rather than writing a policy from scratch, you usually start from a **policy family** — a Databricks-provided template for a common case (personal compute, shared job compute, power user, …) with rules pre-populated. You can override individual rules without losing the rest; Databricks keeps shipping updates to the family's baseline that your overrides survive.

### The JSON definition

A policy maps a cluster attribute — the same field names as the Clusters API, e.g. `spark_version`, `node_type_id`, `num_workers`, `custom_tags.*` — to exactly one rule type:

| Type | What it does |
| --- | --- |
| `fixed` | locks the attribute to one value; can also `hide` the field from the UI |
| `allowlist` | restricts the value to a specific set, with an optional `defaultValue` |
| `range` | constrains a numeric attribute between `minValue` and `maxValue` |
| `unlimited` | leaves the value free but can still set a `defaultValue` or mark it `isOptional` |
| `forbidden` | the attribute can't be set at all |

An attribute gets exactly one type — never both range-limited and allowlisted. Array attributes, like init scripts, use a wildcard (`init_scripts.*`) or an index (`init_scripts.0`) for per-position control.

### Job compute vs all-purpose

The mechanics are the same, but enforcement timing differs: a **job compute** policy change applies immediately, since a job cluster is created fresh every run. An **all-purpose** cluster is long-lived, so a stricter policy shows as "policy violation, enforce on next restart" rather than killing the session — it catches up next time someone restarts it.

### Cost control, tagging, and permissions

Cost control is `range` or `fixed` on attributes that drive the hourly bill: `node_type_id`, `num_workers`, `autotermination_minutes`, `spark_version` (to keep Photon mandatory — see [[runtime-and-photon]]). Tagging is the same idea on `custom_tags.<key>`: fix `cost_center` and every cluster under the policy carries it into billing.

Policies have their own ACL: workspace admins can use and manage all of them by default; anyone else needs an explicit **Can Use** or **Can Manage** grant. No grant means no policy dropdown, and the workspace default applies instead.

### Interaction with pools and instance types

A policy can point at [[instance-pools|instance pools]] instead of raw instance types: `instance_pool_id` as `fixed` forces every cluster onto one pool, or `forbidden` blocks pool use so `node_type_id` decides the hardware instead. The pool supplies warm VMs; the policy decides who's allowed to ask for them and in what shape.

## Example

A shared job-compute policy: fixed runtime, bounded autoscaling, a mandatory tag, and pools required.

```json
{
  "spark_version": {
    "type": "fixed",
    "value": "auto:latest-lts",
    "hidden": true
  },
  "num_workers": {
    "type": "range",
    "minValue": 2,
    "maxValue": 20,
    "defaultValue": 4
  },
  "node_type_id": {
    "type": "allowlist",
    "values": ["i3.xlarge", "i3.2xlarge"]
  },
  "instance_pool_id": {
    "type": "fixed",
    "value": "0925-shared-pool"
  },
  "autotermination_minutes": {
    "type": "fixed",
    "value": 30
  },
  "custom_tags.cost_center": {
    "type": "fixed",
    "value": "data-eng"
  },
  "aws_attributes.availability": {
    "type": "forbidden"
  }
}
```

A bundle then just references it by id:

```yaml
resources:
  jobs:
    nightly_etl:
      job_clusters:
        - job_cluster_key: main
          new_cluster:
            policy_id: "${var.job_compute_policy_id}"
            num_workers: 8
```

## Common mistakes

- Trying to combine two rule types on one attribute — a field takes exactly one `type`; conflicting rules are a validation error, not a merge.
- Assuming an all-purpose cluster picks up a tightened policy right away — it only re-checks compliance on restart.
- Setting `hidden: true` on a value the team still needs to see for debugging — they'll be confused about a run's behavior with no visible cause.
- Calling the Clusters API directly and expecting defaults to populate — without `apply_policy_default_values: true`, unset attributes stay unset.
- Handing out "Can Manage" broadly: anyone with it can loosen the very rules the policy exists to enforce.

> [!tip]
> Read a policy top to bottom before applying it: `fixed` fields are non-negotiable, `range`/`allowlist` are the real choice on offer, and `forbidden` is usually a record of something that went wrong before. It reads like a changelog of past incidents.
