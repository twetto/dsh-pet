#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float breath;
    float follow;
    float blink;
};
layout(binding = 1) uniform sampler2D openTexture;
layout(binding = 2) uniform sampler2D halfTexture;
layout(binding = 3) uniform sampler2D closedTexture;

float eyeMask(vec2 point, vec2 center, vec2 radius) {
    return 1.0 - smoothstep(0.78, 1.0, length((point - center) / radius));
}

void main() {
    vec2 uv = qt_TexCoord0;
    float upper = 1.0 - smoothstep(0.54, 0.97, uv.y);
    uv.y += breath * 0.0035 * upper;
    float sides = smoothstep(0.15, 0.28, abs(uv.x - 0.5)) * (1.0 - smoothstep(0.92, 0.97, uv.y));
    uv.x += 0.0012 * follow * sides * sin(uv.y * 6.2831853);
    vec4 base = texture(openTexture, uv);
    vec4 halfPose = texture(halfTexture, uv);
    vec4 closedPose = texture(closedTexture, uv);
    float eyes = max(eyeMask(uv, vec2(0.448, 0.436), vec2(0.064, 0.042)),
                     eyeMask(uv, vec2(0.579, 0.402), vec2(0.060, 0.047)));
    vec4 blinkPose = blink < 0.5 ? mix(base, halfPose, blink * 2.0)
                               : mix(halfPose, closedPose, blink * 2.0 - 1.0);
    fragColor = mix(base, blinkPose, eyes) * qt_Opacity;
}
