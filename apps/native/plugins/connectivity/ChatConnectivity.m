#import <React/RCTBridgeModule.h>

extern char *csw_connectivity_call(const char *request);
extern void csw_connectivity_free(char *response);

@interface ChatConnectivity : NSObject <RCTBridgeModule>
@property(nonatomic, strong) dispatch_group_t calls;
@property(nonatomic) BOOL invalidated;
@property(nonatomic, copy) NSString *owner;
@end

@implementation ChatConnectivity
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init {
    if ((self = [super init])) {
        _calls = dispatch_group_create();
        _owner = [[NSUUID UUID] UUIDString];
    }
    return self;
}
- (void)invalidate {
    @synchronized(self) { _invalidated = YES; }
    dispatch_group_notify(_calls, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        NSString *request = [NSString stringWithFormat:@"{\"operation\":\"reset\",\"owner\":\"%@\"}", self.owner];
        char *reply = csw_connectivity_call([request UTF8String]);
        csw_connectivity_free(reply);
    });
}

RCT_EXPORT_METHOD(call:(NSString *)request resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    if (!request || request.length > 256 * 1024) {
        reject(@"CONNECTION_UNAVAILABLE", @"连接请求无效，请重试。", nil); return;
    }
    @synchronized(self) {
        if (_invalidated) { reject(@"CONNECTION_CLOSED", @"连接已关闭。", nil); return; }
        dispatch_group_enter(_calls);
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        id value = [NSJSONSerialization JSONObjectWithData:[request dataUsingEncoding:NSUTF8StringEncoding]
            options:NSJSONReadingMutableContainers error:NULL];
        if (![value isKindOfClass:[NSMutableDictionary class]]) {
            reject(@"CONNECTION_UNAVAILABLE", @"连接请求无效，请重试。", nil);
            dispatch_group_leave(self.calls); return;
        }
        value[@"owner"] = self.owner;
        NSData *encoded = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
        NSString *owned = [[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding];
        char *response = csw_connectivity_call([owned UTF8String]);
        if (!response) {
            reject(@"CONNECTION_UNAVAILABLE", @"暂时无法直连，请稍后重试。", nil);
            dispatch_group_leave(self.calls); return;
        }
        NSString *reply = [NSString stringWithUTF8String:response];
        csw_connectivity_free(response);
        if (reply) resolve(reply);
        else reject(@"CONNECTION_UNAVAILABLE", @"暂时无法直连，请稍后重试。", nil);
        dispatch_group_leave(self.calls);
    });
}
@end
