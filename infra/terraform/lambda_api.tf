resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.lambda_function_name}"
  retention_in_days = var.lambda_log_retention_days
}

resource "aws_lambda_function" "api" {
  function_name = local.lambda_function_name
  role          = aws_iam_role.lambda_exec.arn
  handler       = "app.lambda_handler.lambda_handler"
  runtime       = var.lambda_runtime
  architectures = ["x86_64"]

  filename         = local.lambda_zip_file
  source_code_hash = try(filebase64sha256(local.lambda_zip_file), null)

  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_seconds

  reserved_concurrent_executions = var.lambda_reserved_concurrency

  environment {
    variables = {
      API_ORIGIN_HEADER_NAME  = var.api_origin_header_name
      API_ORIGIN_HEADER_VALUE = random_password.api_origin_header.result
      API_PATH_PREFIX         = "/api"
      APP_DATA_TABLE_NAME     = aws_dynamodb_table.app_data.name
      OPENROUTER_API_KEY      = var.openrouter_api_key
      OPENROUTER_MODEL        = var.openrouter_model
      RAW_PLAN_BUCKET_NAME    = aws_s3_bucket.raw_plans.bucket
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda_permissions,
  ]
}
