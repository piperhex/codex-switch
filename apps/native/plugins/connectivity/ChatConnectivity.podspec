require 'json'
version = JSON.parse(File.read(File.join(__dir__, '../../package.json')))['version']
Pod::Spec.new do |s|
  s.name = 'ChatConnectivity'
  s.version = version
  s.summary = 'Session-scoped native chat connectivity'
  s.homepage = 'https://github.com/EasyTier/EasyTier'
  s.license = { :type => 'Apache-2.0' }
  s.author = 'Codex Switch'
  s.platform = :ios, '15.1'
  s.source = { :path => '.' }
  s.source_files = 'ChatConnectivity.m'
  s.dependency 'React-Core'
  s.vendored_frameworks = 'build/ChatConnectivity.xcframework'
  s.resource_bundles = { 'ChatConnectivityNotices' => ['build/notices/*'] }
  s.frameworks = 'Security', 'SystemConfiguration'
  s.libraries = 'c++', 'resolv'
  # pod install also runs for local podspecs, so build before CocoaPods inspects the framework.
  unless system('node', File.join(__dir__, '../../scripts/build-chat-connectivity.cjs'), 'ios')
    raise 'Chat connectivity Rust build failed'
  end
end
