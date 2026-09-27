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

int main() {
    retains_changes_while_throttled();
    preserves_tiny_changes_and_erasure();
}
