#include "video.hpp"
#include "audio.hpp"
#include "pacing.hpp"
#include "desktop_context.hpp"
#include <charconv>
#include <cstdio>
#include <fcntl.h>
#include <io.h>
#include <string_view>

namespace desktop {
namespace {
uint64_t number(std::string_view text) {
    uint64_t value = 0;
    const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (result.ec != std::errc{} || result.ptr != text.data() + text.size())
        throw std::runtime_error("invalid argument");
    return value;
}

Config parse(int argc, char** argv) {
    if (argc != 7) throw std::runtime_error("invalid arguments");
    const auto width = number(argv[1]), height = number(argv[2]), fps = number(argv[3]);
    const auto bitrate = number(argv[4]), monitor = number(argv[5]);
    const std::string_view backend(argv[6]);
    if (width < 2 || height < 2 || width > 16384 || height > 16384
        || width * height > 16'777'216 || width % 2 || height % 2
        || fps < 1 || fps > 144 || bitrate < 200'000 || bitrate > 32'000'000 || monitor == 0
        || (backend != "gpu" && backend != "gdi")) throw std::runtime_error("invalid settings");
    return {static_cast<int>(width), static_cast<int>(height), static_cast<int>(fps),
        static_cast<int>(bitrate), reinterpret_cast<HMONITOR>(monitor), backend == "gdi"};
}

void stream_gpu(const Config& config, Encoder& encoder) {
    Capture capture(encoder.gpu(), config);
    DamageGate gate(config.fps);
    FrameWait wait;
    for (;;) {
        if (encoder.poll_controls()) {
            gate.set_fps(encoder.fps()); gate.observe(true); capture.frame_rate(encoder.fps());
        }
        const bool captured = capture.poll(gate);
        const auto now = Clock::now();
        if (captured && gate.due(now)) {
            encoder.submit(capture.texture().get());
            gate.submitted(now);
        }
        encoder.receive();
        wait.until(Clock::now() + std::chrono::milliseconds(1));
    }
}

void stream_gdi(const Config& config, Encoder& encoder) {
    GdiCapture capture(config);
    capture.open();
    DamageGate gate(config.fps);
    FrameWait wait;
    auto next = Clock::now();
    for (;;) {
        if (encoder.poll_controls()) { gate.set_fps(encoder.fps()); gate.observe(true); }
        const auto interval = std::chrono::nanoseconds(1'000'000'000 / encoder.fps());
        capture.poll(gate);
        const auto now = Clock::now();
        if (gate.due(now)) {
            encoder.submit(capture);
            gate.submitted(now);
        }
        encoder.receive();
        const auto finished = Clock::now();
        next += interval * ((finished - next) / interval + 1);
        wait.until(next);
    }
}
}
}

int main(int argc, char** argv) {
    try {
        _setmode(_fileno(stdout), _O_BINARY);
        desktop::bind_service_desktop();
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
        av_log_set_level(AV_LOG_ERROR);
        if (argc == 2 && std::string_view(argv[1]) == "audio") { desktop::audio::stream(); return 0; }
        const auto config = desktop::parse(argc, argv);
        desktop::Encoder encoder(config);
        const unsigned char capabilities[] = {4, 0, 0, 0, 'C', 'S', 'W', '2'};
        if (std::fwrite(capabilities, 1, sizeof(capabilities), stdout) != sizeof(capabilities)
            || std::fflush(stdout) != 0) throw std::runtime_error("video output closed");
        if (config.gdi) desktop::stream_gdi(config, encoder);
        else desktop::stream_gpu(config, encoder);
        return 0;
    } catch (const winrt::hresult_error& error) {
        std::fprintf(stderr, "desktop-video Windows error=%08lx\n", static_cast<unsigned long>(error.code().value));
    } catch (const std::exception& error) {
        std::fprintf(stderr, "desktop-video: %s\n", error.what());
    }
    return 1;
}
