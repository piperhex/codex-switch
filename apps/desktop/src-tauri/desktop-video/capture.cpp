#include "video.hpp"
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <dxgi.h>

namespace desktop {
using namespace winrt;
using namespace winrt::Windows::Graphics;
using namespace winrt::Windows::Graphics::Capture;

Capture::Capture(ID3D11Device* device, const Config& config) {
    auto interop = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    GraphicsCaptureItem item{nullptr};
    if (config.window)
        check_hresult(interop->CreateForWindow(config.window, guid_of<GraphicsCaptureItem>(), put_abi(item)));
    else
        check_hresult(interop->CreateForMonitor(config.monitor, guid_of<GraphicsCaptureItem>(), put_abi(item)));
    Com<IDXGIDevice> dxgi;
    check_hresult(device->QueryInterface(dxgi.put()));
    Com<IInspectable> inspectable;
    check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), inspectable.put()));
    auto capture_device = inspectable.as<winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();
    size = item.Size();
    pool = Direct3D11CaptureFramePool::CreateFreeThreaded(capture_device,
        winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
    session = pool.CreateCaptureSession(item);
    // ReportOnly keeps complete surfaces: skipped/coalesced frames can never leave stale rectangles.
    // Older Windows throws E_NOINTERFACE here and the host selects its compatibility backend.
    session.DirtyRegionMode(GraphicsCaptureDirtyRegionMode::ReportOnly);
    session.IsCursorCaptureEnabled(false);
    session.StartCapture();
}

Capture::~Capture() {
    if (latest) latest.Close();
    if (session) session.Close();
    if (pool) pool.Close();
}

bool Capture::poll(DamageGate& gate) {
    // Bound draining so a high-refresh source cannot starve encoding. Preserve damage across all frames.
    for (int count = 0; count < 8; ++count) {
        auto frame = pool.TryGetNextFrame();
        if (!frame) break;
        const auto dimensions = frame.ContentSize();
        if (dimensions.Width != size.Width || dimensions.Height != size.Height)
            throw std::runtime_error("display size changed");
        bool changed = false;
        for (const auto& rect : frame.DirtyRegions()) {
            changed |= rect.Width > 0 && rect.Height > 0 && rect.X < size.Width && rect.Y < size.Height;
        }
        gate.observe(changed);
        if (latest) latest.Close();
        latest = std::move(frame);
    }
    return static_cast<bool>(latest);
}

Com<ID3D11Texture2D> Capture::texture() const {
    auto access = latest.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
    Com<ID3D11Texture2D> texture;
    check_hresult(access->GetInterface(__uuidof(ID3D11Texture2D), texture.put_void()));
    return texture;
}
}
