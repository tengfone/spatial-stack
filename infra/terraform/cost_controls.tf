resource "aws_budgets_budget" "monthly_cost" {
  count = local.cost_alerts_enabled ? 1 : 0

  name         = "${local.name_prefix}-monthly-cost"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.cost_alert_email]
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.cost_alert_email]
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.cost_alert_email]
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
  }
}

resource "aws_sns_topic" "usage_alerts" {
  count = local.cost_alerts_enabled && var.enable_usage_alarms ? 1 : 0

  name = "${local.name_prefix}-usage-alerts"
}

resource "aws_sns_topic_subscription" "usage_alert_email" {
  count = local.cost_alerts_enabled && var.enable_usage_alarms ? 1 : 0

  topic_arn = aws_sns_topic.usage_alerts[0].arn
  protocol  = "email"
  endpoint  = var.cost_alert_email
}

resource "aws_cloudwatch_metric_alarm" "lambda_daily_invocations" {
  count = local.cost_alerts_enabled && var.enable_usage_alarms ? 1 : 0

  alarm_name          = "${local.lambda_function_name}-daily-invocations"
  alarm_description   = "API Lambda invocation count exceeded the demo guardrail threshold for one day."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = var.lambda_daily_invocation_alarm_threshold
  treat_missing_data  = "notBreaching"

  namespace   = "AWS/Lambda"
  metric_name = "Invocations"
  statistic   = "Sum"
  period      = 86400

  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }

  alarm_actions = [aws_sns_topic.usage_alerts[0].arn]
  ok_actions    = [aws_sns_topic.usage_alerts[0].arn]
}

resource "aws_sns_topic" "billing_alerts" {
  count    = local.cost_alerts_enabled && var.enable_cloudwatch_billing_alarm ? 1 : 0
  provider = aws.us_east_1

  name = "${local.name_prefix}-billing-alerts"
}

resource "aws_sns_topic_subscription" "billing_alert_email" {
  count    = local.cost_alerts_enabled && var.enable_cloudwatch_billing_alarm ? 1 : 0
  provider = aws.us_east_1

  topic_arn = aws_sns_topic.billing_alerts[0].arn
  protocol  = "email"
  endpoint  = var.cost_alert_email
}

resource "aws_cloudwatch_metric_alarm" "estimated_charges" {
  count    = local.cost_alerts_enabled && var.enable_cloudwatch_billing_alarm ? 1 : 0
  provider = aws.us_east_1

  alarm_name          = "${local.name_prefix}-estimated-charges"
  alarm_description   = "Estimated AWS charges exceeded the configured demo threshold."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = var.billing_alarm_threshold_usd
  treat_missing_data  = "notBreaching"

  namespace   = "AWS/Billing"
  metric_name = "EstimatedCharges"
  statistic   = "Maximum"
  period      = 21600

  dimensions = {
    Currency = "USD"
  }

  alarm_actions = [aws_sns_topic.billing_alerts[0].arn]
  ok_actions    = [aws_sns_topic.billing_alerts[0].arn]
}

