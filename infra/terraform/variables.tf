variable "project_name" {
  description = "Short project name used in AWS resource names."
  type        = string
  default     = "spatial-stack"
}

variable "environment" {
  description = "Deployment environment name used in AWS resource names."
  type        = string
  default     = "demo"
}

variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "ap-southeast-1"
}

variable "frontend_bucket_name" {
  description = "Optional globally unique bucket name for the static frontend. Leave empty to derive one."
  type        = string
  default     = ""
}

variable "raw_plan_bucket_name" {
  description = "Optional globally unique bucket name for raw uploaded floor plans. Leave empty to derive one."
  type        = string
  default     = ""
}

variable "dynamodb_table_name" {
  description = "Optional DynamoDB table name. Leave empty to derive one."
  type        = string
  default     = ""
}

variable "lambda_function_name" {
  description = "Optional Lambda function name. Leave empty to derive one."
  type        = string
  default     = ""
}

variable "lambda_runtime" {
  description = "Python runtime for the API Lambda."
  type        = string
  default     = "python3.12"
}

variable "lambda_memory_mb" {
  description = "Memory size for the API Lambda."
  type        = number
  default     = 256
}

variable "lambda_timeout_seconds" {
  description = "Timeout for the API Lambda."
  type        = number
  default     = 180
}

variable "lambda_log_retention_days" {
  description = "CloudWatch log retention for the API Lambda."
  type        = number
  default     = 7
}

variable "lambda_zip_path" {
  description = "Path to the Lambda deployment ZIP, relative to this Terraform directory."
  type        = string
  default     = "build/lambda_api.zip"
}

variable "api_origin_header_name" {
  description = "Private header name CloudFront adds when forwarding /api/* requests to API Gateway."
  type        = string
  default     = "x-spatial-stack-origin"

  validation {
    condition     = can(regex("^[A-Za-z0-9-]+$", var.api_origin_header_name))
    error_message = "api_origin_header_name may contain only letters, numbers, and hyphens."
  }
}

variable "api_throttle_burst_limit" {
  description = "Maximum short burst of API requests allowed by API Gateway."
  type        = number
  default     = 10
}

variable "api_throttle_rate_limit" {
  description = "Steady-state API request rate limit per second."
  type        = number
  default     = 5
}

variable "lambda_reserved_concurrency" {
  description = "Reserved concurrency cap for the API Lambda. Set -1 to remove the cap."
  type        = number
  default     = 5
}

variable "raw_plan_expiration_days" {
  description = "Delete raw uploaded plans after this many days. Set 0 to disable expiry."
  type        = number
  default     = 30
}

variable "openrouter_api_key" {
  description = "OpenRouter API key used by the Lambda. Required for live floor-plan analysis."
  type        = string
  default     = ""
  sensitive   = true
}

variable "openrouter_model" {
  description = "OpenRouter model ID used by the Lambda for floor-plan analysis."
  type        = string
  default     = "google/gemini-3-flash-preview"
}

variable "force_destroy_buckets" {
  description = "Whether Terraform may delete non-empty S3 buckets during destroy."
  type        = bool
  default     = false
}

variable "cost_alert_email" {
  description = "Email address for AWS Budget and CloudWatch cost alerts. Leave empty to skip alert resources."
  type        = string
  default     = ""
}

variable "monthly_budget_limit_usd" {
  description = "Monthly AWS cost budget limit in USD."
  type        = number
  default     = 10
}

variable "enable_cloudwatch_billing_alarm" {
  description = "Create a CloudWatch EstimatedCharges alarm in us-east-1 when cost_alert_email is set."
  type        = bool
  default     = true
}

variable "billing_alarm_threshold_usd" {
  description = "CloudWatch EstimatedCharges alarm threshold in USD."
  type        = number
  default     = 5
}

variable "enable_usage_alarms" {
  description = "Create lightweight usage alarms when cost_alert_email is set."
  type        = bool
  default     = true
}

variable "lambda_daily_invocation_alarm_threshold" {
  description = "Alarm when daily Lambda invocations exceed this count."
  type        = number
  default     = 5000
}

variable "tags" {
  description = "Additional tags for all supported resources."
  type        = map(string)
  default     = {}
}
