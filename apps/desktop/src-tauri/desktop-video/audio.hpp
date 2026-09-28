#pragma once
#include <array>
#include <cstddef>
#include <deque>

namespace desktop::audio {
constexpr int sample_rate = 48'000;
constexpr int channels = 2;
constexpr int frame_samples = 960;
constexpr int frame_values = frame_samples * channels;
using Frame = std::array<float, frame_values>;

// Keep at most 60 ms of captured sound. A stalled consumer must resume with recent audio.
class Buffer {
public:
    void push(const float* data, size_t count) {
        if (count >= capacity) { if (data) data += count - capacity; count = capacity; values.clear(); }
        while (values.size() + count > capacity) values.pop_front();
        for (size_t i = 0; i < count; ++i) values.push_back(data ? data[i] : 0.0f);
    }
    Frame next() {
        Frame frame{};
        for (size_t i = 0; i < frame.size() && !values.empty(); ++i) {
            frame[i] = values.front(); values.pop_front();
        }
        return frame;
    }
private:
    static constexpr size_t capacity = frame_values * 3;
    std::deque<float> values;
};

void stream();
}
