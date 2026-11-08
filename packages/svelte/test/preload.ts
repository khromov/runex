// Every test file: drop the settings that change what an app draws (runex's own preload does the same).
delete process.env.RUNEX_PERF
delete process.env.RUNEX_TITLEBAR
