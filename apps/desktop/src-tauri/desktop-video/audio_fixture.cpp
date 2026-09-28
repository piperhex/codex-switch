#include "video.hpp"
#include "audio.hpp"
#include "pacing.hpp"
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#include <cmath>
#include <cstdio>

// Native test source: render a quiet tone on the same default endpoint used by loopback capture.
int main() {
    try {
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
        auto enumerator = winrt::create_instance<IMMDeviceEnumerator>(__uuidof(MMDeviceEnumerator));
        desktop::Com<IMMDevice> device;
        winrt::check_hresult(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, device.put()));
        desktop::Com<IAudioClient> client;
        winrt::check_hresult(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, client.put_void()));
        WAVEFORMATEX format{WAVE_FORMAT_IEEE_FLOAT, 2, 48'000, 384'000, 8, 32, 0};
        winrt::check_hresult(client->Initialize(AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, 1'000'000, 0, &format, nullptr));
        desktop::Com<IAudioRenderClient> render;
        winrt::check_hresult(client->GetService(__uuidof(IAudioRenderClient), render.put_void()));
        UINT32 capacity = 0;
        winrt::check_hresult(client->GetBufferSize(&capacity));
        winrt::check_hresult(client->Start());
        desktop::FrameWait wait;
        uint64_t position = 0;
        for (;;) {
            UINT32 padding = 0;
            winrt::check_hresult(client->GetCurrentPadding(&padding));
            const auto frames = capacity - padding;
            if (frames) {
                BYTE* data = nullptr;
                winrt::check_hresult(render->GetBuffer(frames, &data));
                auto samples = reinterpret_cast<float*>(data);
                for (UINT32 i = 0; i < frames; ++i, ++position) {
                    const auto value = static_cast<float>(0.01 * std::sin(position * 6.28318530718 * 440 / 48'000));
                    samples[i * 2] = value; samples[i * 2 + 1] = value;
                }
                winrt::check_hresult(render->ReleaseBuffer(frames, 0));
            }
            wait.until(desktop::Clock::now() + std::chrono::milliseconds(5));
        }
    } catch (const winrt::hresult_error& error) {
        std::fprintf(stderr, "audio fixture Windows error=%08lx\n", static_cast<unsigned long>(error.code().value));
    } catch (const std::exception& error) { std::fprintf(stderr, "audio fixture: %s\n", error.what()); }
    return 1;
}
