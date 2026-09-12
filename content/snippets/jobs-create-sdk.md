```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service import jobs

w = WorkspaceClient()

job = w.jobs.create(
    name="daily_sales",
    tasks=[
        jobs.Task(
            task_key="clean",
            notebook_task=jobs.NotebookTask(notebook_path="/Workspace/etl/clean_sales"),
        ),
        jobs.Task(
            task_key="aggregate",
            depends_on=[jobs.TaskDependency(task_key="clean")],
            sql_task=jobs.SqlTask(
                warehouse_id="<warehouse-id>",
                file=jobs.SqlTaskFile(path="/Workspace/etl/aggregate_sales.sql"),
            ),
        ),
    ],
)
print(job.job_id)
```
