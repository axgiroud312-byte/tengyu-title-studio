from pathlib import Path

import pytest
from PIL import Image


class MemoryCredentials:
    def __init__(self, key="test-only-not-a-real-key"):
        self.key = key

    def get(self, provider):
        return self.key

    def set(self, provider, key):
        self.key = key


@pytest.fixture
def credentials():
    return MemoryCredentials()


@pytest.fixture
def make_image():
    def create(path: Path, color="blue"):
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (120, 160), color).save(path)
        return path
    return create
