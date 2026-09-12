---
id: ai-runtime
title: AI Runtime and serverless GPU compute
area: experiments
level: advanced
summary: "Serverless GPU compute for training and fine-tuning: a @distributed decorator in notebooks, the air CLI with a workload YAML, and the successor to Foundation Model Fine-tuning."
prerequisites: [mlflow-tracking, serverless-compute]
related: [automl, models-in-uc, foundation-model-apis, model-serving-endpoints, secrets-management]
exams: []
sources:
  - url: https://docs.databricks.com/aws/en/machine-learning/ai-runtime/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/ai-runtime/distributed-training
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/ai-runtime/cli/
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/ai-runtime/cli/installation
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/ai-runtime/cli/command-reference
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/machine-learning/ai-runtime/cli/yaml-config
    checked: 2026-09-12
  - url: https://docs.databricks.com/aws/en/large-language-models/foundation-model-training/
    checked: 2026-09-12
aliases: [serverless gpu, serverless GPU compute, air, air cli, databricks-air, serverless_gpu, distributed decorator, fine-tuning, foundation model fine-tuning, FMFT, deep learning on databricks]
updated: 2026-09-12
status: published
maturity: public-preview
maturity_checked: 2026-09-12
---

> [!note]
> Maturity here is not uniform. As of September 2026 **AI Runtime** itself and the **`air` CLI** carry a Public Preview banner, while the **`@distributed` notebook decorator** carries a Beta banner. A workspace admin has to enable the preview before any of it appears. Read this to know where fine-tuning on Databricks lives now, not to hang a release date on.

## What it is

**AI Runtime** is serverless GPU compute for training and fine-tuning. You ask for a number of accelerators of a given type, Databricks provisions them, runs your Python on them, and releases them when the work finishes. There is no cluster to size, no driver to keep alive and no GPU quota sitting idle between experiments.

Three accelerator shapes exist: `1xA10` (one GPU, 24 GB) for small and medium jobs, `1xH100` (one GPU, 80 GB) for medium-scale work, and `8xH100` (eight 80 GB GPUs on a single node), which is the only shape that supports distributed training. The workspace has to be in `us-west-2`, `us-west-1`, `us-east-1`, `us-east-2`, `ca-central-1` or `sa-east-1`.

Two entry points lead to the same compute. From a notebook you decorate a function and call it; from a terminal you write a YAML file and submit it with a CLI. Both produce MLflow runs, so a training job's record lands exactly where [[mlflow-tracking]] already puts everything else.

## Why it exists

This is where fine-tuning on Databricks now lives, because the previous answer is gone. **Foundation Model Fine-tuning has reached end of life and is no longer supported.** The `databricks_genai` package and the Foundation Model Fine-tuning UI are both no longer available, and the documentation for them now points at AI Runtime. Anyone whose fine-tuning pipeline imported `databricks_genai` is rewriting it, not maintaining it.

The older path was also narrower than people needed. It fine-tuned a fixed catalogue of base models through an API that accepted a task type and a training table. Anything outside that shape, a custom loss, a vision encoder, a reinforcement-learning loop, meant provisioning a GPU cluster by hand, installing CUDA-dependent wheels, and paying for the cluster while you read the stack trace. AI Runtime replaces both halves with one primitive: arbitrary Python on GPUs you do not manage.

## How it works

### Two managed environments

The **Standard** environment is minimal and leaves dependency choices to you. The **Databricks AI** environment is preloaded with the usual deep-learning stack, including PyTorch and Transformers. Either way you add pip packages declaratively, and if a dependency needs system libraries or a compiled CUDA extension such as flash-attn, you register a custom Docker image instead. A web terminal is available on the compute, so `nvidia-smi` works when you want to see what the GPUs are actually doing. Ray is supported for distributed workloads that are not plain PyTorch.

### The notebook path: `@distributed`

`from serverless_gpu import distributed` gives you a decorator. You wrap a training function, then submit it by calling `.distributed()` on the decorated function with the function's own arguments:

| Parameter | Meaning |
| --- | --- |
| `gpus` | number of GPUs; `8` for the `8xH100` shape |
| `gpu_type` | `'H100'` or `'A10'`; auto-detected if omitted |
| `timeout` | seconds, in GPU environment v5 and above; the default is 3 hours |

Everything the function needs has to be defined inside it, data loading included. The arguments are pickled to reach the workers, and a dataset larger than pickle allows is the usual first failure. Each call creates an MLflow run, or a nested child run when one is already active, and prints a link to it.

### The CLI path: `air`

`air` is the same compute driven from a laptop or an IDE, with the job description checked into Git rather than living in a notebook cell. Install it as a tool, not as a library:

```bash
uv tool install --force databricks-air --python 3.12   # Python 3.10 or above is required
databricks auth login --host https://<workspace-url>
air --version
```

Six commands cover the lifecycle: `air run` submits a workload YAML, `air get run` shows one run's status and configuration, `air list runs` lists recent ones (`--active` for those still going), `air logs` streams or downloads output (`--node` for one worker, `--download-to` for a file), `air cancel` stops a run, and `air register image` caches a custom Docker image. Every command takes `-p` for a Databricks CLI profile, or reads `DATABRICKS_CONFIG_PROFILE`.

The workload YAML requires `experiment_name`, a `compute` block and a `command`. `compute.accelerator_type` is one of `GPU_1xA10`, `GPU_1xH100` or `GPU_8xH100`, and `num_accelerators` has to agree with it: exactly 1 for `GPU_1xH100`, a multiple of 8 for `GPU_8xH100`, any positive integer for `GPU_1xA10`. The optional blocks are where the useful details sit: `environment` (a `version`, a `dependencies` list, or a `docker_image.url`), `code_source` (a `snapshot` of a local directory, optionally pinned to a Git `branch` or `commit`, with `include_paths` to keep the upload small), `parameters` for structured hyperparameters, `env_variables`, `secrets` referenced as `scope/key` so no token is written into the file (see [[secrets-management]]), plus `max_retries`, `timeout_minutes` and `usage_policy_name` for a budget policy.

### Connection limits, which are not runtime limits

An interactive notebook connection times out after 15 minutes of inactivity, while notebook jobs and CLI jobs hold theirs for 24 hours. The work itself runs longer: up to seven days for a connected notebook session or a notebook job, and up to 14 days for a CLI job. Losing the notebook connection is therefore not the same thing as losing the run.

## Example: the same fine-tune from a notebook and from a terminal

In a notebook, on all eight GPUs of one node:

```python
from serverless_gpu import distributed
import os, torch, torch.distributed as dist

@distributed(gpus=8, gpu_type="H100", timeout=7200)
def run_train(num_epochs: int, batch_size: int) -> None:
    import mlflow
    from torch.nn.parallel import DistributedDataParallel as DDP
    from torch.utils.data import DataLoader, DistributedSampler

    torch.cuda.set_device(int(os.environ["LOCAL_RANK"]))
    dist.init_process_group("nccl")
    device = torch.device(f"cuda:{int(os.environ['LOCAL_RANK'])}")

    dataset = load_dataset_from_volume("/Volumes/main/ml/training/support_tickets")
    sampler = DistributedSampler(dataset)
    loader = DataLoader(dataset, sampler=sampler, batch_size=batch_size)
    model = DDP(build_model().to(device), device_ids=[device])
    optimiser = torch.optim.AdamW(model.parameters(), lr=2e-5)

    for epoch in range(num_epochs):
        sampler.set_epoch(epoch)
        for step, (xb, yb) in enumerate(loader):
            loss = model(xb.to(device), labels=yb.to(device)).loss
            mlflow.log_metric("loss", loss.item(), step=step)  # lands in the run this call created
            loss.backward()
            optimiser.step()
            optimiser.zero_grad()

    dist.destroy_process_group()

run_train.distributed(num_epochs=3, batch_size=8)
```

The same job as a checked-in workload, `train.yaml`:

```yaml
experiment_name: /Shared/support-ticket-finetune
mlflow_artifact_location: /Volumes/main/ml/mlflow-artifacts/finetune
compute:
  num_accelerators: 8
  accelerator_type: GPU_8xH100
environment:
  version: 'databricks_ai_v5'
  dependencies:
    - transformers>=4.30
  secrets:
    HF_TOKEN: 'ml_team/huggingface_token'
code_source:
  type: snapshot
  snapshot:
    root_path: /Users/me/support-finetune
    git:
      branch: main
    include_paths:
      - src
command: torchrun --nproc_per_node=8 $CODE_SOURCE_PATH/src/train.py
max_retries: 1
timeout_minutes: 180
usage_policy_name: ml_team_policy
```

```bash
air run --file train.yaml -p prod --watch
air logs <run-id> --download-to ./logs/
```

Either way the resulting model gets registered in [[models-in-uc]] and served from a [[model-serving-endpoints|serving endpoint]], which is unchanged from before.

## Common mistakes

- **Loading the dataset outside the decorated function.** The arguments are pickled to reach the eight workers, so a DataFrame passed in from the notebook either fails on size or silently costs you a serialisation round trip. Load inside the function.
- **Asking for distributed training on `1xH100`.** Multi-GPU data parallelism needs the `8xH100` shape. `num_accelerators` also has to match the shape: a multiple of 8 for `GPU_8xH100`, exactly 1 for `GPU_1xH100`.
- **Treating a lost notebook connection as a lost run.** The interactive connection drops after 15 minutes of inactivity, while the job keeps going for up to seven days. Use `air list runs` or the MLflow run link rather than restarting.
- **Porting a `databricks_genai` pipeline by changing imports.** Foundation Model Fine-tuning is at end of life, not deprecated-but-working, and the package is gone. The training loop has to be written as ordinary PyTorch.
- **Putting an API token in the workload YAML.** `environment.secrets` takes `scope/key` references precisely so the file can live in Git.
- **Reading Public Preview as almost-GA.** The notebook decorator is a step behind the runtime at Beta, and the whole feature needs a workspace admin to enable it. Prototype on it, do not promise on it.
