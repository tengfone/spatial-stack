output "frontend_bucket_name" {
  description = "Private S3 bucket that stores the static frontend."
  value       = aws_s3_bucket.frontend.bucket
}

output "frontend_url" {
  description = "Public HTTPS CloudFront URL for the frontend."
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "frontend_cloudfront_distribution_id" {
  description = "CloudFront distribution ID for frontend cache invalidations."
  value       = aws_cloudfront_distribution.frontend.id
}

output "frontend_cloudfront_domain_name" {
  description = "CloudFront domain name for the frontend."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "frontend_website_endpoint" {
  description = "Deprecated compatibility alias for frontend_url."
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "api_base_url" {
  description = "CloudFront API base URL to use as VITE_API_BASE_URL."
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}/api"
}

output "frontend_api_base_path" {
  description = "Same-origin API base path for frontend builds."
  value       = "/api"
}

output "raw_plan_bucket_name" {
  description = "Private S3 bucket for raw uploaded floor plans."
  value       = aws_s3_bucket.raw_plans.bucket
}

output "dynamodb_table_name" {
  description = "DynamoDB table for app data and plan results."
  value       = aws_dynamodb_table.app_data.name
}

output "aws_region" {
  description = "AWS region used for this deployment."
  value       = var.aws_region
}

output "monthly_budget_name" {
  description = "AWS Budget name when cost_alert_email is configured."
  value       = try(aws_budgets_budget.monthly_cost[0].name, null)
}

output "billing_alarm_name" {
  description = "CloudWatch billing alarm name when enabled."
  value       = try(aws_cloudwatch_metric_alarm.estimated_charges[0].alarm_name, null)
}

