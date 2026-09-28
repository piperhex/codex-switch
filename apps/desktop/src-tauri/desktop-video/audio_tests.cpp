#include "audio.hpp"
#include <algorithm>
#include <stdexcept>
#include <vector>

using namespace desktop::audio;
void require(bool valid) { if (!valid) throw std::runtime_error("audio buffer regression"); }

int main() {
    Buffer buffer;
    const auto silent = buffer.next();
    require(std::all_of(silent.begin(), silent.end(), [](float value) { return value == 0; }));
    const float samples[] = {0.25f, -0.5f, 0.75f, -1.0f};
    buffer.push(samples, 4);
    const auto partial = buffer.next();
    require(std::equal(samples, samples + 4, partial.begin()));
    require(std::all_of(partial.begin() + 4, partial.end(), [](float value) { return value == 0; }));
    buffer.push(nullptr, frame_values);
    require(buffer.next() == silent);
    std::vector<float> backlog(frame_values * 4);
    for (size_t i = 0; i < backlog.size(); ++i) backlog[i] = static_cast<float>(i);
    buffer.push(backlog.data(), backlog.size());
    const auto recent = buffer.next();
    require(recent.front() == frame_values && recent.back() == frame_values * 2 - 1);
    buffer.push(samples, 4);
    require(buffer.next().front() == frame_values * 2);
}
