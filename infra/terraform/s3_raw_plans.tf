resource "aws_s3_bucket" "raw_plans" {
  bucket        = local.raw_plan_bucket_name
  force_destroy = var.force_destroy_buckets
}

resource "aws_s3_bucket_ownership_controls" "raw_plans" {
  bucket = aws_s3_bucket.raw_plans.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "raw_plans" {
  bucket = aws_s3_bucket.raw_plans.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "raw_plans" {
  bucket = aws_s3_bucket.raw_plans.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "raw_plans" {
  count  = var.raw_plan_expiration_days > 0 ? 1 : 0
  bucket = aws_s3_bucket.raw_plans.id

  rule {
    id     = "expire-raw-plan-uploads"
    status = "Enabled"

    filter {
      prefix = ""
    }

    expiration {
      days = var.raw_plan_expiration_days
    }
  }
}

