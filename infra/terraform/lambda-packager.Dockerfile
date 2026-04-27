ARG LAMBDA_PYTHON_VERSION=3.12
FROM public.ecr.aws/lambda/python:${LAMBDA_PYTHON_VERSION}

ENV HOME=/tmp \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PYTHON_BIN=python3 \
    PYTHON_VERSION=3.12 \
    PYTHON_ABI=cp312 \
    PLATFORM=manylinux2014_x86_64

WORKDIR /workspace

ENTRYPOINT ["/bin/bash", "infra/terraform/scripts/package_lambda.sh"]

