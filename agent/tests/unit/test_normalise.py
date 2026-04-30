"""TDD tests for agent/normalise.py — all written before implementation."""
import pytest


class TestUrlNormalisation:
    def test_lowercases_url(self):
        from agent.normalise import normalise_url
        result = normalise_url("https://NAUKRI.COM/Job/J001?foo=bar")
        assert result == result.lower()

    def test_strips_irrelevant_query_params(self):
        from agent.normalise import normalise_url
        url_with_tracking = "https://naukri.com/job/j001?utm_source=google&utm_medium=cpc"
        result = normalise_url(url_with_tracking)
        assert "utm_source" not in result
        assert "utm_medium" not in result

    def test_preserves_job_id_param(self):
        from agent.normalise import normalise_url
        url = "https://naukri.com/job-listings/caio?jobId=12345&utm_source=google"
        result = normalise_url(url)
        assert "jobId=12345" in result or "jobid=12345" in result


class TestExactUrlDedup:
    def test_exact_url_marks_duplicate(self):
        from agent.normalise import deduplicate_batch
        from agent.models import RawJob

        job = RawJob(
            title="Head of AI",
            company="Acme",
            jd_raw="...",
            source="naukri",
            source_url="https://naukri.com/job/j001",
        )
        seen_urls = {"https://naukri.com/job/j001"}
        results = deduplicate_batch([job], seen_urls=seen_urls, seen_keys=[])
        assert results[0].is_duplicate is True
        assert results[0].duplicate_of_url == "https://naukri.com/job/j001"

    def test_new_url_not_duplicate(self):
        from agent.normalise import deduplicate_batch
        from agent.models import RawJob

        job = RawJob(
            title="Head of AI",
            company="Acme",
            jd_raw="...",
            source="naukri",
            source_url="https://naukri.com/job/j999",
        )
        results = deduplicate_batch([job], seen_urls=set(), seen_keys=[])
        assert results[0].is_duplicate is False


class TestFuzzyDedup:
    def test_head_of_ai_variants_are_duplicate(self):
        """'Head of AI' and 'Head, Artificial Intelligence' at same company → duplicate."""
        from agent.normalise import deduplicate_batch
        from agent.models import RawJob

        job1 = RawJob(
            title="Head of AI",
            company="Acme Corp",
            jd_raw="...",
            source="naukri",
            source_url="https://naukri.com/job/j001",
        )
        job2 = RawJob(
            title="Head, Artificial Intelligence",
            company="Acme Corp",
            jd_raw="...",
            source="iimjobs",
            source_url="https://iimjobs.com/job/j002",
        )
        results = deduplicate_batch([job1, job2], seen_urls=set(), seen_keys=[])
        # First job is new; second is a fuzzy duplicate of first
        assert results[0].is_duplicate is False
        assert results[1].is_duplicate is True

    def test_different_roles_not_duplicate(self):
        """'Head of AI' and 'Head of Data' at same company → NOT duplicate."""
        from agent.normalise import deduplicate_batch
        from agent.models import RawJob

        job1 = RawJob(
            title="Head of AI",
            company="Acme Corp",
            jd_raw="...",
            source="naukri",
            source_url="https://naukri.com/job/j001",
        )
        job2 = RawJob(
            title="Head of Data",
            company="Acme Corp",
            jd_raw="...",
            source="naukri",
            source_url="https://naukri.com/job/j003",
        )
        results = deduplicate_batch([job1, job2], seen_urls=set(), seen_keys=[])
        assert results[0].is_duplicate is False
        assert results[1].is_duplicate is False

    def test_abbreviation_expansion_vp(self):
        """'VP of AI' and 'Vice President of AI' at same company → duplicate."""
        from agent.normalise import build_dedup_key, is_fuzzy_duplicate

        key1 = build_dedup_key("Acme Corp", "VP of AI")
        key2 = build_dedup_key("Acme Corp", "Vice President of AI")
        assert is_fuzzy_duplicate(key1, key2)

    def test_same_company_required_for_fuzzy_duplicate(self):
        """Same title at different companies → NOT duplicate."""
        from agent.normalise import deduplicate_batch
        from agent.models import RawJob

        job1 = RawJob(
            title="Head of AI",
            company="Acme Corp",
            jd_raw="...",
            source="naukri",
            source_url="https://naukri.com/job/j001",
        )
        job2 = RawJob(
            title="Head of AI",
            company="Different Corp",
            jd_raw="...",
            source="naukri",
            source_url="https://naukri.com/job/j004",
        )
        results = deduplicate_batch([job1, job2], seen_urls=set(), seen_keys=[])
        assert results[0].is_duplicate is False
        assert results[1].is_duplicate is False
