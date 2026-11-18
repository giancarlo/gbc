export const references = `%gb.heap = type { i64, ptr, i32, i32 }
declare void @free(ptr)
define internal void @gb.retain(ptr %object) {
entry:
  %null = icmp eq ptr %object, null
  br i1 %null, label %end, label %read
read:
  %count = load i64, ptr %object
  %static = icmp eq i64 %count, -1
  br i1 %static, label %end, label %increment
increment:
  %next = add i64 %count, 1
  store i64 %next, ptr %object
  br label %end
end:
  ret void
}
define internal void @gb.release(ptr %object) {
entry:
  %null = icmp eq ptr %object, null
  br i1 %null, label %end, label %read
read:
  %count = load i64, ptr %object
  %static = icmp eq i64 %count, -1
  br i1 %static, label %end, label %decrement
decrement:
  %next = sub i64 %count, 1
  store i64 %next, ptr %object
  %last = icmp eq i64 %next, 0
  br i1 %last, label %drop, label %end
drop:
  %slot = getelementptr %gb.heap, ptr %object, i32 0, i32 1
  %destructor = load ptr, ptr %slot
  %trivial = icmp eq ptr %destructor, null
  br i1 %trivial, label %free, label %members
members:
  call void %destructor(ptr %object)
  br label %free
free:
  call void @free(ptr %object)
  br label %end
end:
  ret void
}`;

export const allocator = `declare ptr @calloc(i64, i64)
define internal nonnull ptr @gb.allocate(i64 %size, i32 %length, i32 %capacity, ptr %destructor) {
entry:
  %header = ptrtoint ptr getelementptr (%gb.heap, ptr null, i32 1) to i64
  %total = add i64 %header, %size
  %object = call ptr @calloc(i64 1, i64 %total)
  %failed = icmp eq ptr %object, null
  br i1 %failed, label %trap, label %initialize
trap:
  call i32 @fflush(ptr null)
  call void @llvm.trap()
  unreachable
initialize:
  store i64 1, ptr %object
  %drop = getelementptr %gb.heap, ptr %object, i32 0, i32 1
  store ptr %destructor, ptr %drop
  %len = getelementptr %gb.heap, ptr %object, i32 0, i32 2
  store i32 %length, ptr %len
  %cap = getelementptr %gb.heap, ptr %object, i32 0, i32 3
  store i32 %capacity, ptr %cap
  ret ptr %object
}`;

export function dropBuffer(name: string, drop: string): string {
	return `define internal void ${name}(ptr %object) {
entry:
  %data = getelementptr %gb.heap, ptr %object, i32 1
  %header = getelementptr %gb.heap, ptr %object, i32 0, i32 2
  %length = load i32, ptr %header
  br label %test
test:
  %index = phi i32 [ 0, %entry ], [ %next, %drop ]
  %end = icmp eq i32 %index, %length
  br i1 %end, label %finish, label %drop
drop:
${drop}
  %next = add i32 %index, 1
  br label %test
finish:
  ret void
}`;
}

export const printString = `define internal void @gb.print.string(ptr %object) {
entry:
  %null = icmp eq ptr %object, null
  br i1 %null, label %end, label %read
read:
  %header = getelementptr %gb.heap, ptr %object, i32 0, i32 2
  %length = load i32, ptr %header
  %data = getelementptr %gb.heap, ptr %object, i32 1
  br label %test
test:
  %index = phi i32 [ 0, %read ], [ %next, %print ]
  %done = icmp eq i32 %index, %length
  br i1 %done, label %end, label %print
print:
  %slot = getelementptr i8, ptr %data, i32 %index
  %byte = load i8, ptr %slot
  %character = zext i8 %byte to i32
  call i32 @putchar(i32 %character)
  %next = add i32 %index, 1
  br label %test
end:
  ret void
}`;
