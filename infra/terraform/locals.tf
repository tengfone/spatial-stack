locals {
  normalized_project_name = trim(replace(lower(var.project_name), "/[^a-z0-9-]/", "-"), "-")
  normalized_environment  = trim(replace(lower(var.environment), "/[^a-z0-9-]/", "-"), "-")
  name_prefix             = "${local.normalized_project_name}-${local.normalized_environment}"

  s3_name_prefix = trim(
    substr(
      replace("${local.name_prefix}-${data.aws_caller_identity.current.account_id}-${var.aws_region}", "/[^a-z0-9-]/", "-"),
      0,
      50
    ),
    "-"
  )

  frontend_bucket_name = var.frontend_bucket_name != "" ? var.frontend_bucket_name : "${local.s3_name_prefix}-frontend"
  raw_plan_bucket_name = var.raw_plan_bucket_name != "" ? var.raw_plan_bucket_name : "${local.s3_name_prefix}-raw-plans"
  dynamodb_table_name  = var.dynamodb_table_name != "" ? var.dynamodb_table_name : "${local.name_prefix}-app-data"
  lambda_function_name = var.lambda_function_name != "" ? var.lambda_function_name : "${local.name_prefix}-api"
  api_name             = "${local.name_prefix}-http-api"
  lambda_zip_file      = "${path.module}/${var.lambda_zip_path}"
  cost_alerts_enabled  = trimspace(var.cost_alert_email) != ""

  common_tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Scenario    = "C"
    },
    var.tags
  )
}

