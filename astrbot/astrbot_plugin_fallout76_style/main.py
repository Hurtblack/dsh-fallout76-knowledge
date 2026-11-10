"""AstrBot plugin entry. No reply, tool, memory, or permission registration."""
import asyncio

from astrbot.api import AstrBotConfig, logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.provider import ProviderRequest
from astrbot.api.star import Context, Star

from .adapter import History, Options, append_style
from .sources import from_event


class Fallout76Style(Star):
    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context)
        self.config = config
        self.options = self.state = self.history = self.task = None
        self.stop = asyncio.Event()
        self._errors = {}

    async def initialize(self):
        if self.config.get("enabled") is not True:
            return
        try:
            self.options = Options.from_config(self.config)
        except (TypeError, ValueError, OSError) as exc:
            self._error("configuration", exc)
            return
        self.state = self.options.store()
        self.history = History(self.options)
        if self.options.learn:
            self.task = asyncio.create_task(self._work())

    def _error(self, stage, exc):
        # Never log raw exception text from parsing user messages or the final request.
        code = type(exc).__name__
        if self._errors.get(stage) != code:
            self._errors[stage] = code
            logger.warning(f"[Fallout76Style] {stage} failed ({code}); check the scope/path and use offline status")

    async def _work(self):
        while not self.stop.is_set():
            try:
                if await asyncio.to_thread(self.history.refresh, self.state):
                    logger.info("[Fallout76Style] imported new group history style samples")
                self._errors.pop("history", None)
            except Exception as exc:
                self._error("history", exc)
            if not self.stop.is_set() and self.state.path.is_file():
                try:
                    result, version = await asyncio.to_thread(
                        self.state.evolve, self.options.minimum, self.options.every, self.options.daily)
                    self._errors.pop("evolve", None)
                    if result == "applied":
                        logger.info(f"[Fallout76Style] auto-applied version={version}")
                except Exception as exc:
                    self._error("evolve", exc)
            try:
                await asyncio.wait_for(self.stop.wait(), timeout=self.options.interval)
            except asyncio.TimeoutError:
                pass

    async def terminate(self):
        self.stop.set()
        if self.task:
            await self.task

    @filter.event_message_type(filter.EventMessageType.GROUP_MESSAGE, priority=5)
    async def observe(self, event: AstrMessageEvent):
        if not self.options or not self.options.learn or self.stop.is_set():
            return
        try:
            if not self.options.matches(event) or str(event.get_sender_id()) in self.options.bots:
                return
            sample = from_event(event, self.options.bots)
            if sample:
                await asyncio.to_thread(self.state.ingest, [sample])
            self._errors.pop("observe", None)
        except Exception as exc:
            self._error("observe", exc)

    @filter.on_llm_request(priority=5)
    async def apply_style(self, event: AstrMessageEvent, req: ProviderRequest):
        if not self.options or not self.options.inject or self.stop.is_set():
            return
        try:
            if not self.options.matches(event):
                return
            version, profile = await asyncio.to_thread(self.state.active)
            if append_style(req, profile) and self.options.log_hook:
                logger.info(f"[Fallout76Style] on_llm_request attached version={version}")
            self._errors.pop("request", None)
        except Exception as exc:
            self._error("request", exc)
