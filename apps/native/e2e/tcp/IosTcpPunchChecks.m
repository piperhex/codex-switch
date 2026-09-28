#import <Foundation/Foundation.h>
#import "GCDAsyncSocket.h"
#import <sys/socket.h>

static void Require(BOOL condition, NSString *message) {
    if (!condition) @throw [NSException exceptionWithName:@"TcpPunchCheck" reason:message userInfo:nil];
}

static void WaitFor(BOOL (^ready)(void)) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:10];
    while (!ready() && [deadline timeIntervalSinceNow] > 0) {
        [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    }
    Require(ready(), @"Timed out waiting for TCP traffic");
}

@interface PunchChecks : NSObject <GCDAsyncSocketDelegate>
@property(nonatomic, strong) NSMutableArray<GCDAsyncSocket *> *sockets;
@property(nonatomic, strong) NSMutableSet<GCDAsyncSocket *> *echoed;
@property(nonatomic, strong) NSMutableArray<NSError *> *errors;
@property(nonatomic, strong) NSData *payload;
@end

@implementation PunchChecks
- (instancetype)init {
    if ((self = [super init])) {
        _sockets = [NSMutableArray new];
        _echoed = [NSMutableSet new];
        _errors = [NSMutableArray new];
        _payload = [[@"TCP punch data " stringByPaddingToLength:65536 withString:@"0123456789" startingAtIndex:0]
            dataUsingEncoding:NSUTF8StringEncoding];
    }
    return self;
}

- (GCDAsyncSocket *)socket:(BOOL)ipv6 reuse:(BOOL)reuse {
    GCDAsyncSocket *socket = [[GCDAsyncSocket alloc] initWithDelegate:self delegateQueue:dispatch_get_main_queue()];
    socket.csw_reusePort = reuse;
    socket.IPv4Enabled = !ipv6;
    socket.IPv6Enabled = ipv6;
    [self.sockets addObject:socket];
    return socket;
}

- (GCDAsyncSocket *)listen:(BOOL)ipv6 reuse:(BOOL)reuse {
    GCDAsyncSocket *socket = [self socket:ipv6 reuse:reuse];
    NSError *error = nil;
    Require([socket acceptOnInterface:nil port:0 error:&error], error.localizedDescription ?: @"listen failed");
    __block int enabled = -1;
    [socket performBlock:^{
        socklen_t length = sizeof(enabled);
        int descriptor = ipv6 ? [socket socket6FD] : [socket socket4FD];
        Require(getsockopt(descriptor, SOL_SOCKET, SO_REUSEPORT, &enabled, &length) == 0,
            @"Cannot inspect listener port reuse");
    }];
    Require((enabled != 0) == reuse, @"Port sharing changed a socket that did not opt in");
    return socket;
}

- (GCDAsyncSocket *)dial:(GCDAsyncSocket *)destination source:(uint16_t)source ipv6:(BOOL)ipv6 {
    GCDAsyncSocket *socket = [self socket:ipv6 reuse:YES];
    NSError *error = nil;
    NSString *interface = [NSString stringWithFormat:@":%hu", source];
    BOOL started = [socket connectToHost:ipv6 ? @"::1" : @"127.0.0.1" onPort:destination.localPort
        viaInterface:interface withTimeout:5 error:&error];
    Require(started, error.localizedDescription ?: @"connect failed");
    return socket;
}

- (void)socket:(GCDAsyncSocket *)sender didAcceptNewSocket:(GCDAsyncSocket *)socket {
    [self.sockets addObject:socket];
    [socket readDataToLength:self.payload.length withTimeout:5 tag:1];
}

- (void)socket:(GCDAsyncSocket *)socket didConnectToHost:(NSString *)host port:(uint16_t)port {
    [socket readDataToLength:self.payload.length withTimeout:5 tag:2];
    [socket writeData:self.payload withTimeout:5 tag:0];
}

- (void)socket:(GCDAsyncSocket *)socket didReadData:(NSData *)data withTag:(long)tag {
    Require([data isEqualToData:self.payload], @"Corrupted TCP payload");
    if (tag == 1) [socket writeData:data withTimeout:5 tag:0];
    else [self.echoed addObject:socket];
}

- (void)socketDidDisconnect:(GCDAsyncSocket *)socket withError:(NSError *)error {
    if (error) [self.errors addObject:error];
}

- (void)checkFamily:(BOOL)ipv6 {
    GCDAsyncSocket *discovery = [self listen:ipv6 reuse:NO];
    GCDAsyncSocket *left = [self listen:ipv6 reuse:YES];
    GCDAsyncSocket *right = [self listen:ipv6 reuse:YES];
    GCDAsyncSocket *leftDiscovery = [self dial:discovery source:left.localPort ipv6:ipv6];
    GCDAsyncSocket *rightDiscovery = [self dial:discovery source:right.localPort ipv6:ipv6];
    WaitFor(^BOOL { return [self.echoed containsObject:leftDiscovery] && [self.echoed containsObject:rightDiscovery]; });
    Require(leftDiscovery.localPort == left.localPort, @"Discovery changed the listener source port");
    Require(rightDiscovery.localPort == right.localPort, @"Discovery changed the peer source port");
    GCDAsyncSocket *direct = [self dial:right source:left.localPort ipv6:ipv6];
    WaitFor(^BOOL { return [self.echoed containsObject:direct]; });
    Require(direct.localPort == left.localPort, @"Peer dialing changed the discovery source port");
    Require(leftDiscovery.isConnected && rightDiscovery.isConnected, @"Peer dial closed discovery");
    Require(!left.isDisconnected && !right.isDisconnected, @"Peer dial closed listeners");
    Require(self.errors.count == 0, self.errors.firstObject.localizedDescription ?: @"Unexpected socket error");
    [self close];
}

- (void)close {
    for (GCDAsyncSocket *socket in self.sockets) {
        [socket setDelegate:nil];
        [socket disconnect];
        Require(socket.isDisconnected, @"Socket remained open after cleanup");
    }
    [self.sockets removeAllObjects];
}
@end

int main(void) {
    @autoreleasepool {
        @try {
            for (NSNumber *family in @[@NO, @YES]) {
                PunchChecks *checks = [PunchChecks new];
                @try { [checks checkFamily:family.boolValue]; }
                @finally { [checks close]; }
            }
            puts("IOS_TCP_PUNCH_PASS: IPv4/IPv6 listener, discovery and peer share ports; 64 KiB echo; cleanup");
            return 0;
        } @catch (NSException *error) {
            fprintf(stderr, "IOS_TCP_PUNCH_FAIL: %s\n", error.reason.UTF8String);
            return 1;
        }
    }
}
