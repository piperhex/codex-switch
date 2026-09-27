#pragma once
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <span>

namespace desktop {
using Clock = std::chrono::steady_clock;
// A periodic full refresh bounds recovery after packet loss, even on an idle desktop.
constexpr auto refresh_interval = std::chrono::seconds(2);

class DamageGate {
    Clock::duration interval;
    Clock::time_point sent{};
    Clock::time_point next{};
    bool pending = true;
    bool started = false;
public:
    explicit DamageGate(int fps) : interval(std::chrono::nanoseconds(1'000'000'000 / fps)) {}
    void observe(bool changed) { pending |= changed; }
    bool due(Clock::time_point now) const {
        return !started || now - sent >= refresh_interval || (pending && now >= next);
    }
    void submitted(Clock::time_point now) {
        // Keep the original cadence: resetting from each arrival quantizes 144 Hz -> 60 FPS to 48 FPS.
        // Advance past missed slots without emitting a burst after an idle screen or slow encoder.
        if (!started) next = now + interval;
        else if (now >= next) next += interval * ((now - next) / interval + 1);
        sent = now; started = true; pending = false;
    }
};

struct DamageRect {
    int left = 0, top = 0, right = 0, bottom = 0;
    bool empty() const { return left >= right || top >= bottom; }
};

// Exact row comparisons retain one-pixel/text changes; no perceptual threshold is used.
inline DamageRect changed_rows(std::span<const uint8_t> previous, std::span<const uint8_t> current,
    int width, int height) {
    const auto stride = static_cast<size_t>(width) * 4;
    if (previous.size() != current.size()) return {0, 0, width, height};
    DamageRect damage{0, height, width, 0};
    for (int row = 0; row < height; ++row) {
        const auto offset = static_cast<size_t>(row) * stride;
        if (std::memcmp(previous.data() + offset, current.data() + offset, stride) == 0) continue;
        damage.top = std::min(damage.top, row);
        damage.bottom = row + 1;
    }
    return damage;
}
}
