#include "audio.hpp"
#include "video.hpp"
#include "pacing.hpp"
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#include <cstdio>

namespace desktop::audio {
namespace {
constexpr auto interval = std::chrono::milliseconds(20);

std::wstring endpoint_id(IMMDevice* device) {
    LPWSTR value = nullptr;
    winrt::check_hresult(device->GetId(&value));
    const std::unique_ptr<wchar_t, decltype(&CoTaskMemFree)> owner(value, CoTaskMemFree);
    return value;
}

class Loopback {
public:
    Loopback() {
        enumerator = winrt::create_instance<IMMDeviceEnumerator>(__uuidof(MMDeviceEnumerator));
        winrt::check_hresult(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, device.put()));
        device_id = endpoint_id(device.get());
        winrt::check_hresult(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, client.put_void()));
        WAVEFORMATEX format{};
        format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
        format.nChannels = channels; format.nSamplesPerSec = sample_rate; format.wBitsPerSample = 32;
        format.nBlockAlign = channels * sizeof(float);
        format.nAvgBytesPerSec = sample_rate * format.nBlockAlign;
        // The shared audio engine performs channel/rate conversion, including surround output devices.
        winrt::check_hresult(client->Initialize(AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, 1'000'000, 0, &format, nullptr));
        winrt::check_hresult(client->GetService(__uuidof(IAudioCaptureClient), capture.put_void()));
        winrt::check_hresult(client->Start());
    }
    ~Loopback() {
        if (client) client->Stop(); // Best effort when the endpoint has been unplugged.
    }
    void poll(Buffer& buffer) {
        UINT32 pending = 0;
        winrt::check_hresult(capture->GetNextPacketSize(&pending));
        while (pending > 0) {
            BYTE* data = nullptr;
            UINT32 frames = 0; DWORD flags = 0;
            winrt::check_hresult(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr));
            try {
                buffer.push(flags & AUDCLNT_BUFFERFLAGS_SILENT ? nullptr : reinterpret_cast<float*>(data),
                    static_cast<size_t>(frames) * channels);
            } catch (...) { capture->ReleaseBuffer(frames); throw; }
            winrt::check_hresult(capture->ReleaseBuffer(frames));
            winrt::check_hresult(capture->GetNextPacketSize(&pending));
        }
    }
    void check_device() const {
        Com<IMMDevice> current;
        winrt::check_hresult(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, current.put()));
        if (endpoint_id(current.get()) != device_id) throw std::runtime_error("audio output changed");
    }
private:
    Com<IMMDeviceEnumerator> enumerator;
    Com<IMMDevice> device;
    Com<IAudioClient> client;
    Com<IAudioCaptureClient> capture;
    std::wstring device_id;
};

class Opus {
public:
    Opus() : packet(av_packet_alloc()), frame(av_frame_alloc()) {
        const auto implementation = avcodec_find_encoder_by_name("libopus");
        if (!implementation || !packet || !frame) throw std::runtime_error("audio encoder unavailable");
        codec.reset(avcodec_alloc_context3(implementation));
        if (!codec) throw std::bad_alloc();
        codec->sample_rate = sample_rate; codec->sample_fmt = AV_SAMPLE_FMT_FLT;
        codec->time_base = {1, sample_rate}; codec->bit_rate = 96'000;
        av_channel_layout_default(&codec->ch_layout, channels);
        check(av_opt_set(codec->priv_data, "application", "lowdelay", 0));
        check(av_opt_set(codec->priv_data, "frame_duration", "20", 0));
        check(avcodec_open2(codec.get(), implementation, nullptr));
        if (codec->frame_size != frame_samples) throw std::runtime_error("invalid audio frame size");
        frame->format = codec->sample_fmt; frame->sample_rate = sample_rate; frame->nb_samples = frame_samples;
        check(av_channel_layout_copy(&frame->ch_layout, &codec->ch_layout));
        check(av_frame_get_buffer(frame.get(), 0));
    }
    void submit(const audio::Frame& samples, int64_t capture_ticks) {
        check(av_frame_make_writable(frame.get()));
        std::memcpy(frame->data[0], samples.data(), sizeof(samples));
        frame->pts = capture_ticks; position = capture_ticks;
        check(avcodec_send_frame(codec.get(), frame.get()));
        for (;;) {
            const auto result = avcodec_receive_packet(codec.get(), packet.get());
            if (result == AVERROR(EAGAIN)) return;
            check(result); write(); av_packet_unref(packet.get());
        }
    }
private:
    void write() const {
        const auto length = static_cast<uint32_t>(packet->size) + sizeof(uint64_t);
        if (packet->size <= 0 || length > 4'000) throw std::runtime_error("invalid audio packet");
        const uint8_t header[] = {static_cast<uint8_t>(length), static_cast<uint8_t>(length >> 8), 0, 0};
        uint8_t timestamp[sizeof(uint64_t)];
        for (size_t i = 0; i < sizeof(timestamp); ++i) timestamp[i] = static_cast<uint8_t>(position >> (8 * i));
        if (std::fwrite(header, 1, sizeof(header), stdout) != sizeof(header)
            || std::fwrite(timestamp, 1, sizeof(timestamp), stdout) != sizeof(timestamp)
            || std::fwrite(packet->data, 1, packet->size, stdout) != static_cast<size_t>(packet->size)
            || std::fflush(stdout) != 0)
            throw std::runtime_error("audio output closed");
    }
    Codec codec;
    Packet packet;
    desktop::Frame frame;
    int64_t position = 0;
};
}

void stream() {
    Loopback capture;
    Opus encoder;
    Buffer buffer;
    FrameWait wait;
    const auto started = Clock::now();
    auto next = started + interval;
    auto device_check = next;
    for (;;) {
        capture.poll(buffer);
        const auto now = Clock::now();
        if (now >= device_check) { capture.check_device(); device_check = now + std::chrono::seconds(1); }
        if (now >= next) {
            // Silence keeps the RTP clock running even when WASAPI has no active render clients.
            encoder.submit(buffer.next(), ((now - started) / interval) * frame_samples);
            next += interval * ((now - next) / interval + 1);
        }
        wait.until(Clock::now() + std::chrono::milliseconds(2));
    }
}
}
