#include "damage.hpp"
#include <stdexcept>
#include <vector>

using namespace desktop;
void require(bool condition) { if (!condition) throw std::runtime_error("damage regression"); }

void retains_changes_while_throttled() {
    const Clock::time_point start{};
    DamageGate gate(60);
    require(gate.due(start));
    gate.submitted(start);
    gate.observe(true);
    gate.observe(false);
    require(!gate.due(start + std::chrono::milliseconds(5)));
    require(gate.due(start + std::chrono::milliseconds(17)));
    gate.submitted(start + std::chrono::milliseconds(17));
    require(!gate.due(start + std::chrono::seconds(1)));
    require(gate.due(start + std::chrono::seconds(3)));
}

void preserves_tiny_changes_and_erasure() {
    std::vector<uint8_t> first(64 * 64 * 4), next = first;
    require(changed_rows(first, next, 64, 64).empty());
    next[(23 * 64 + 17) * 4] = 1;
    auto rect = changed_rows(first, next, 64, 64);
    require(rect.top == 23 && rect.bottom == 24);
    require(!changed_rows(next, first, 64, 64).empty());
    require(!changed_rows({}, first, 64, 64).empty());
}

void preserves_requested_average_with_a_faster_source() {
    for (const int source_fps : {120, 144, 165}) {
        DamageGate gate(60);
        int frames = 0;
        for (int tick = 0; tick < source_fps * 10; ++tick) {
            const auto now = Clock::time_point{} + std::chrono::nanoseconds(1'000'000'000LL * tick / source_fps);
            gate.observe(true);
            if (!gate.due(now)) continue;
            gate.submitted(now);
            ++frames;
        }
        require(frames >= 599 && frames <= 601);
    }
}

void skips_missed_slots_without_bursts_or_duplicate_updates() {
    DamageGate gate(60);
    const Clock::time_point start{};
    gate.submitted(start);
    gate.observe(true);
    const auto delayed = start + std::chrono::milliseconds(450);
    require(gate.due(delayed));
    gate.submitted(delayed);
    require(!gate.due(delayed));
    gate.observe(true);
    require(!gate.due(delayed));
    require(gate.due(delayed + std::chrono::milliseconds(17)));
}

int main() {
    retains_changes_while_throttled();
    preserves_tiny_changes_and_erasure();
    preserves_requested_average_with_a_faster_source();
    skips_missed_slots_without_bursts_or_duplicate_updates();
}
