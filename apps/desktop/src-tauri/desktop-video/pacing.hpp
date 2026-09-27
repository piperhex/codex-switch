#pragma once
#include "damage.hpp"
#include <windows.h>
#include <stdexcept>

namespace desktop {
// Sleep(1) can sleep ~16 ms on Windows. A per-process high-resolution timer preserves 60/120 FPS
// without changing the system timer period or busy-spinning on the capture thread.
class FrameWait {
    HANDLE timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
        TIMER_MODIFY_STATE | SYNCHRONIZE);
public:
    FrameWait() { if (!timer) throw std::runtime_error("video timer unavailable"); }
    FrameWait(const FrameWait&) = delete;
    FrameWait& operator=(const FrameWait&) = delete;
    ~FrameWait() { CloseHandle(timer); }
    void until(Clock::time_point deadline) {
        const auto remaining = deadline - Clock::now();
        if (remaining <= Clock::duration::zero()) return;
        LARGE_INTEGER due{};
        due.QuadPart = -std::max<int64_t>(1,
            std::chrono::duration_cast<std::chrono::nanoseconds>(remaining).count() / 100);
        if (!SetWaitableTimer(timer, &due, 0, nullptr, nullptr, FALSE)
            || WaitForSingleObject(timer, INFINITE) != WAIT_OBJECT_0)
            throw std::runtime_error("video timer failed");
    }
};
}
